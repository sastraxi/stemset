"""BSMamba2 model implementation for 4-stem separation."""

from pathlib import Path

from .base import BaseModelSeparator
from .metadata import get_metadata_analyzer


class BSMamba2ModelSeparator(BaseModelSeparator):
    """TS-BSmamba2 model implementation for 4-stem separation using Mamba2 architecture."""
    
    STEM_NAMES = ["vocals", "drums", "bass", "other"]
    
    def __init__(self, profile):
        """Initialize BSMamba2 separator."""
        super().__init__(profile)
        self.model = None
        self.device = None
        
    def _ensure_model_loaded(self) -> None:
        """Lazy load the BSMamba2 model."""
        if self.model is None:
            import torch
            import os
            
            # Limit CPU threads to be nice to interactive processes
            cpu_count = os.cpu_count() or 4
            thread_count = max(1, cpu_count // 2)
            torch.set_num_threads(thread_count)
            torch.set_num_interop_threads(thread_count)
            print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

            # Import and create the BSMamba2 model
            try:
                from .bsmamba2_model import TSBSMamba2Separator
                
                # Use CUDA if available, otherwise CPU
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                
                # Create model (4-stem output: vocals, drums, bass, other)
                self.model = TSBSMamba2Separator(
                    sr=self.SAMPLE_RATE,
                    win=2048,
                    stride=512,
                    feature_dim=128,
                    num_repeat_mask=8,  # Full model, use 4 for lightweight
                    num_repeat_map=4,   # Full model, use 2 for lightweight  
                    num_output=4
                ).to(device)
                
                # Try to load pre-trained weights if available
                model_dir = Path.home() / ".stemset" / "models" 
                model_path = model_dir / "bsmamba2_pretrained.pth"
                
                if model_path.exists():
                    print(f"Loading pre-trained BSMamba2 weights from {model_path}")
                    checkpoint = torch.load(model_path, map_location=device)
                    self.model.load_state_dict(checkpoint)
                else:
                    print("Warning: No pre-trained BSMamba2 weights found. Model will use random weights.")
                    print(f"Expected weights at: {model_path}")
                    print("BSMamba2 model may not perform well without pre-trained weights.")
                
                self.model.eval()
                self.device = device
                
                print(f"BSMamba2 model loaded on {device}")
                
            except ImportError as e:
                raise RuntimeError(
                    "BSMamba2 model requires mamba-ssm package. Install with: pip install mamba-ssm"
                ) from e

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio into stems using BSMamba2."""
        import torch
        import torchaudio
        
        output_folder.mkdir(parents=True, exist_ok=True)

        # Ensure model is loaded
        self._ensure_model_loaded()

        print(f"Separating {input_file.name} with BSMamba2...")

        # Load audio file
        waveform, sample_rate = torchaudio.load(str(input_file))
        
        # Resample to model's expected sample rate if needed
        if sample_rate != self.SAMPLE_RATE:
            resampler = torchaudio.transforms.Resample(sample_rate, self.SAMPLE_RATE)
            waveform = resampler(waveform)
        
        # Ensure we have the right number of channels (model expects 2 channels)
        if waveform.shape[0] == 1:
            # Mono to stereo
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            # Multi-channel to stereo (take first 2 channels)
            waveform = waveform[:2]
        
        # Move to device and add batch dimension
        waveform = waveform.unsqueeze(0).to(self.device)  # Shape: (1, 2, T)
        
        # Run separation
        with torch.no_grad():
            # BSMamba2 returns (separated_audio, mask_audio) where separated_audio is the final result
            separated_audio, _ = self.model(waveform)
            # separated_audio shape: (batch, num_stems, channels, time) = (1, 4, 2, T)
        
        # Move back to CPU for saving
        separated_audio = separated_audio.squeeze(0).cpu()  # Shape: (4, 2, T)
        
        # Save each stem
        stem_paths = {}
        for i, stem_name in enumerate(self.STEM_NAMES):
            stem_audio = separated_audio[i]  # Shape: (2, T)
            
            # Determine output path and format
            if self.profile.output_format.lower() == "opus":
                stem_path = output_folder / f"{stem_name}.opus"
                # For Opus, use torchaudio with proper encoding
                torchaudio.save(
                    str(stem_path), 
                    stem_audio, 
                    self.SAMPLE_RATE,
                    encoding="VORBIS",
                    compression=self.profile.opus_bitrate / 8  # Convert kbps to compression level approximation
                )
            else:
                # WAV format
                stem_path = output_folder / f"{stem_name}.wav"
                torchaudio.save(str(stem_path), stem_audio, self.SAMPLE_RATE)
            
            stem_paths[stem_name] = stem_path

        # Verify we got all expected stems
        missing = set(self.STEM_NAMES) - set(stem_paths.keys())
        if missing:
            raise RuntimeError(f"BSMamba2 separation incomplete: missing stems {missing}")

        # Analyze and collect metadata using the utility
        analyzer = get_metadata_analyzer()
        stem_metadata = analyzer.create_stems_metadata(stem_paths, self.profile)

        return stem_paths, stem_metadata