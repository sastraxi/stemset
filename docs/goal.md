<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# I want to create an application with two interfaces. One scans a directory for new audio files, then uses a state-of-the-art open model to "stem" them into different categories -- drums, bass, guitars, and vocals, saving the stems. The other interface is a web app that allows users to view the stemmed files with an interface to independently change the volume on playback, so that my fellow bandmates and I can simplify the process of practicing / listening back critically to our live recordings.

The input will be stereo WAV files at whatever khz makes sense for the state-of-the-art stemmer. Let me know which is the best programming language to use for this task -- I would be open for Go, Typescript, or Python, depending on which makes the integration with the stemmer the easiest. Please do deep research on the different "AI" stemmers that are available out there, as well as which are the most recent as of October 19, 2025 (which is today).

Now I have comprehensive information about AI stem separation models, programming language options, and loudness normalization. Let me provide a detailed answer.

## Best Programming Language and AI Stem Separation Solution for Your Application

### **Recommended Language: Python**

Python is the clear choice for your use case. All state-of-the-art stem separation models are built in Python, and trying to use them from Go or TypeScript would add unnecessary complexity through inter-process communication or FFI bindings. The audio processing ecosystem is vastly superior in Python, and you'll save significant development time.[^1][^2]

### **State-of-the-Art Stem Separation Models (October 2025)**

Based on comprehensive research into the latest models, here are the top options:

#### **1. BS-RoFormer (Best Overall - State-of-the-Art)**

**BS-RoFormer** (Band-Split Rotary Transformer) from ByteDance is currently the state-of-the-art model for music source separation.[^3][^4][^5]

- **Performance**: Achieves **11.89 dB SDR** for vocals on recent benchmarks (July 2025), the highest in the industry[^4]
- **Stems**: Separates into vocals, drums, bass, and "other" (guitars/keyboards/piano)
- **6-stem version**: Also available with guitar and piano as separate stems[^6]
- **Sample Rate**: 44.1 kHz[^7]
- **Implementation**: Available through the `audio-separator` Python package or direct PyTorch implementation[^3][^1]
- **Model size**: ~72M parameters per stem[^8]

**Status**: Won first place in the Music Separation contest of Sound Demixing Challenge (SDX'23)[^5]

#### **2. BSMamba2 (Latest Innovation - August 2025)**

A very recent improvement over BS-RoFormer that addresses sparse vocal occurrence issues:[^9]

- **Performance**: **11.03 dB cSDR** for vocals, surpassing BS-RoFormer in specific scenarios[^9]
- **Advantage**: Better handles intermittent vocals and sparse vocal occurrences[^9]
- **Status**: Very recent (August 2025), may have limited production-ready implementations


#### **3. Demucs v4 (Meta/Facebook - Proven \& Reliable)**

**Hybrid Transformer Demucs v4** from Meta is a highly reliable, battle-tested option:[^10][^11][^6]

- **Performance**: 9.0-9.2 dB SDR on MUSDB-HQ benchmark[^6]
- **Architecture**: Hybrid time-domain and frequency-domain processing with Transformers[^6]
- **Models available**:
    - `htdemucs` - Default model, good balance of speed and quality
    - `htdemucs_ft` - Fine-tuned version (4x slower but better quality)
    - `htdemucs_6s` - Six-source separation (vocals, drums, bass, other, guitar, piano)[^6]
- **Sample Rate**: 44.1 kHz[^7]
- **Python API**: Very easy to integrate[^12][^13]

**Important Note**: The original Demucs repository is no longer actively maintained by Meta, but remains stable and widely used[^14][^6]

#### **4. AudioShake (Commercial Grade)**

If you need the absolute highest quality and are willing to pay:

- **Performance**: 13.5 dB SDR for vocals (May 2025) - beats all open-source options[^15]
- **Status**: Commercial API, not open-source[^16][^15]
- **Cost**: Would require API subscription


#### **5. Moises-Light (Efficient Alternative)**

For resource-constrained scenarios:[^17][^18]

- **Performance**: 9.96 dB average SDR on MUSDB-HQ[^17]
- **Size**: Only 5M parameters (13x smaller than BS-RoFormer)[^18]
- **Advantage**: Fast processing, lower memory requirements


### **Recommended Sample Rate: 44.1 kHz**

All top models are trained on **44.1 kHz** audio, which is:[^19][^20][^7]

- The standard for music production and CD audio
- Captures frequencies up to 22.05 kHz (above human hearing range)
- The native rate for the MUSDB-HQ benchmark dataset[^20]
- What BS-RoFormer, Demucs v4, and other SOTA models expect


### **Implementation Recommendation**

**For your application, I recommend BS-RoFormer as primary with Demucs v4 as fallback**:

#### **Architecture Overview**

**Component 1: Directory Scanner (Python)**

```python
from audio_separator.separator import Separator
import pyloudnorm as pyln
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import soundfile as sf
import json
from pathlib import Path

class AudioFileHandler(FileSystemEventHandler):
    def __init__(self, output_dir, loudness_target=-23.0):
        self.separator = Separator()
        # Load BS-RoFormer model (best quality)
        self.separator.load_model('model_bs_roformer_ep_317_sdr_12.9755.ckpt')
        self.loudness_meter = pyln.Meter(44100)  # 44.1kHz
        self.loudness_target = loudness_target
        self.output_dir = Path(output_dir)
        
    def on_created(self, event):
        if event.is_directory:
            return
        
        # Check if it's a WAV file
        if event.src_path.endswith('.wav'):
            self.process_audio_file(event.src_path)
    
    def process_audio_file(self, filepath):
        print(f"Processing: {filepath}")
        
        # Separate stems
        output_files = self.separator.separate(filepath)
        
        # Measure loudness and normalize each stem
        stem_metadata = {}
        for stem_file in output_files:
            # Load the stem
            data, rate = sf.read(stem_file)
            
            # Measure integrated loudness (LUFS)
            loudness = self.loudness_meter.integrated_loudness(data)
            
            # Calculate gain adjustment to reach target
            gain_db = self.loudness_target - loudness
            
            # Store metadata for web interface
            stem_name = Path(stem_file).stem
            stem_metadata[stem_name] = {
                'file': stem_file,
                'original_lufs': float(loudness),
                'gain_adjustment_db': float(gain_db),
                'unity_gain': float(10 ** (gain_db / 20))  # Convert to linear gain
            }
        
        # Save metadata as JSON for web app
        metadata_path = self.output_dir / f"{Path(filepath).stem}_metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(stem_metadata, f, indent=2)
        
        print(f"Completed: {filepath}")

# Usage
if __name__ == "__main__":
    watch_dir = "/path/to/recordings"
    output_dir = "/path/to/stems"
    
    event_handler = AudioFileHandler(output_dir)
    observer = Observer()
    observer.schedule(event_handler, watch_dir, recursive=False)
    observer.start()
    
    print(f"Monitoring {watch_dir} for new WAV files...")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
```

**Component 2: Web Interface (TypeScript/React)**

For the web player, use TypeScript with React and the Web Audio API:[^21]

```typescript
// stemPlayer.tsx
import React, { useEffect, useRef, useState } from 'react';

interface StemMetadata {
  file: string;
  original_lufs: number;
  gain_adjustment_db: number;
  unity_gain: number;
}

interface StemsMetadata {
  [key: string]: StemMetadata;
}

export const StemPlayer: React.FC<{ metadataUrl: string }> = ({ metadataUrl }) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const [stems, setStems] = useState<Map<string, {
    buffer: AudioBuffer;
    source: AudioBufferSourceNode | null;
    gainNode: GainNode;
    metadata: StemMetadata;
  }>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [metadata, setMetadata] = useState<StemsMetadata | null>(null);

  useEffect(() => {
    // Initialize AudioContext
    audioContextRef.current = new AudioContext({ sampleRate: 44100 });
    
    // Fetch metadata and load stems
    loadStems();
    
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  const loadStems = async () => {
    // Fetch metadata
    const response = await fetch(metadataUrl);
    const meta: StemsMetadata = await response.json();
    setMetadata(meta);

    const audioContext = audioContextRef.current!;
    const stemMap = new Map();

    // Load all stems
    for (const [name, stemMeta] of Object.entries(meta)) {
      const audioResponse = await fetch(stemMeta.file);
      const arrayBuffer = await audioResponse.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create gain node with unity gain (normalized loudness)
      const gainNode = audioContext.createGain();
      gainNode.gain.value = stemMeta.unity_gain;
      gainNode.connect(audioContext.destination);

      stemMap.set(name, {
        buffer: audioBuffer,
        source: null,
        gainNode,
        metadata: stemMeta
      });
    }

    setStems(stemMap);
  };

  const play = () => {
    if (!audioContextRef.current) return;
    
    const audioContext = audioContextRef.current;
    const currentTime = audioContext.currentTime;

    // Create and start source for each stem
    stems.forEach((stem, name) => {
      const source = audioContext.createBufferSource();
      source.buffer = stem.buffer;
      source.connect(stem.gainNode);
      source.start(currentTime);
      
      stem.source = source;
    });

    setIsPlaying(true);
  };

  const pause = () => {
    stems.forEach(stem => {
      stem.source?.stop();
      stem.source = null;
    });
    setIsPlaying(false);
  };

  const handleVolumeChange = (stemName: string, volume: number) => {
    const stem = stems.get(stemName);
    if (stem) {
      // Apply volume relative to unity gain
      stem.gainNode.gain.value = stem.metadata.unity_gain * volume;
    }
  };

  return (
    <div className="stem-player">
      <div className="controls">
        <button onClick={isPlaying ? pause : play}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>
      
      <div className="stem-controls">
        {Array.from(stems.entries()).map(([name, stem]) => (
          <div key={name} className="stem-control">
            <label>{name}</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              defaultValue="1"
              onChange={(e) => handleVolumeChange(name, parseFloat(e.target.value))}
            />
            <span>LUFS: {stem.metadata.original_lufs.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```


### **Key Features of This Solution**

1. **Perceptual Loudness Normalization**: Uses **pyloudnorm** to measure integrated loudness (LUFS) following ITU-R BS.1770-4 standard[^22][^23][^24][^25]
    - Measures each stem's loudness after separation
    - Calculates gain adjustment to normalize to -23 LUFS (broadcast standard) or your chosen target
    - Stores unity gain values so web interface starts with perceptually balanced levels
2. **Directory Monitoring**: Uses **watchdog** to automatically detect new WAV files[^26][^27]
3. **State-of-the-Art Separation**: BS-RoFormer provides the best quality available[^4][^5]
4. **Web Audio API**: Enables precise, synchronized playback of multiple stems with independent volume control[^28][^21]

### **Alternative Simplified Approach**

If you want to minimize complexity and accept slightly lower quality:

**Use Demucs v4 directly** - It has a simpler Python API:[^13][^12]

```python
import demucs.separate
import shlex

# Process a file
demucs.separate.main(shlex.split('--two-stems vocals -n htdemucs_ft input.wav'))
```


### **Why Not Go or TypeScript for Stemming?**

- **Go**: No native support for PyTorch models. You'd need to run Python as subprocess or use ONNX (if models are converted), adding complexity[^29][^30]
- **TypeScript/Node**: Same issue - would need to spawn Python processes[^31]
- **Python**: Native ecosystem for all ML models, immediate access to 100+ separation models[^1]


### **Summary Recommendations**

| Component | Technology | Rationale |
| :-- | :-- | :-- |
| Stem Separation | Python + BS-RoFormer | State-of-the-art quality (11.89 dB SDR)[^4] |
| Loudness Analysis | Python + pyloudnorm | ITU-R BS.1770-4 compliant[^22][^25] |
| File Monitoring | Python + watchdog | Simple, reliable[^26][^27] |
| Web Interface | TypeScript/React + Web Audio API | Best browser audio control[^21] |
| Sample Rate | 44.1 kHz | Industry standard for music[^19][^7] |

**Processing Time**: Expect roughly 1.5x the track duration on CPU, much faster with GPU.[^12][^6]

This architecture gives you production-ready stem separation with perceptual loudness normalization and an intuitive web interface for your band to practice with individual stem control.
<span style="display:none">[^100][^101][^102][^103][^104][^105][^106][^107][^108][^109][^110][^111][^112][^113][^114][^115][^116][^117][^118][^119][^120][^121][^122][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50][^51][^52][^53][^54][^55][^56][^57][^58][^59][^60][^61][^62][^63][^64][^65][^66][^67][^68][^69][^70][^71][^72][^73][^74][^75][^76][^77][^78][^79][^80][^81][^82][^83][^84][^85][^86][^87][^88][^89][^90][^91][^92][^93][^94][^95][^96][^97][^98][^99]</span>

<div align="center">⁂</div>

[^1]: https://github.com/nomadkaraoke/python-audio-separator

[^2]: https://github.com/deezer/spleeter

[^3]: https://github.com/lucidrains/BS-RoFormer

[^4]: https://mvsep.com/news

[^5]: https://ieeexplore.ieee.org/document/10446843/

[^6]: https://github.com/facebookresearch/demucs

[^7]: https://docs.pytorch.org/audio/2.1/tutorials/hybrid_demucs_tutorial.html

[^8]: https://arxiv.org/pdf/2510.06785.pdf

[^9]: https://www.arxiv.org/pdf/2508.14556.pdf

[^10]: https://beatstorapon.com/blog/demucs-vs-spleeter-the-ultimate-guide/

[^11]: https://docs.pytorch.org/audio/main/tutorials/hybrid_demucs_tutorial.html

[^12]: https://pydigger.com/pypi/demucs

[^13]: https://pypi.org/project/demucs/2.0.0/

[^14]: https://github.com/facebookresearch/demucs/issues/554

[^15]: https://www.audioshake.ai/post/audioshake-voice-model-achieves-highest-quality-state-of-the-art-benchmark

[^16]: https://www.audioshake.ai/post/latest-models-higher-quality-stems

[^17]: https://arxiv.org/html/2510.06785

[^18]: https://arxiv.org/html/2510.06785v1

[^19]: https://source-separation.github.io/tutorial/basics/representations.html

[^20]: https://source-separation.github.io/tutorial/data/musdb18.html

[^21]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API

[^22]: https://www.eecs.qmul.ac.uk/~josh/documents/2021/21076.pdf

[^23]: https://qmro.qmul.ac.uk/xmlui/handle/123456789/80278

[^24]: https://csteinmetz1.github.io/pyloudnorm-eval/paper/pyloudnorm_preprint.pdf

[^25]: https://github.com/csteinmetz1/pyloudnorm

[^26]: https://dev.to/stokry/monitor-files-for-changes-with-python-1npj

[^27]: https://www.pythonsnacks.com/p/python-watchdog-file-directory-updates

[^28]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume

[^29]: https://github.com/jonchammer/audio-io

[^30]: https://friendlyuser.github.io/posts/tech/go/getting_started_with_go_audio/

[^31]: https://www.npmjs.com/package/@voxextractlabs/vox-demucs

[^32]: https://aimusicgen.ai/vocal-remover

[^33]: https://dataloop.ai/library/model/subcategory/music_source_separation_2182/

[^34]: https://www.siliconflow.com/articles/en/best-open-source-audio-generation-models

[^35]: https://www.reddit.com/r/TechnoProduction/comments/1lb4zpl/the_absolute_bestest_instrument_stem_separation/

[^36]: https://www.unite.ai/best-ai-tools-for-musicians/

[^37]: https://modal.com/blog/open-source-tts

[^38]: https://music.ai/blog/press/stem-separation-sourceaudio/

[^39]: https://www.soundverse.ai/blog/article/the-best-free-ai-stem-splitters-and-vocal-removers-of-2025-splitter-ai-tool

[^40]: https://www.reddit.com/r/edmproduction/comments/1gc2k3m/updated_best_stem_separation_software_right_now/

[^41]: https://blog.landr.com/ai-stem-splitters/

[^42]: https://stemulator.app

[^43]: https://www.siliconflow.com/articles/en/best-open-source-music-generation-models

[^44]: https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models

[^45]: https://www.youtube.com/watch?v=GQtRYsWl6Tg

[^46]: https://music.ai/blog/research/Music-AI-Subjective-Analysis-Source-Separation/

[^47]: https://www.jumpingrivers.com/blog/stem-splitting/

[^48]: https://mastrng.substack.com/p/stems-separator

[^49]: https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1443674-best-stem-separator-2025-a.html

[^50]: https://ultimatevocalremover.com

[^51]: https://summerofcode.withgoogle.com/programs/2025/projects/lRQpeA7K

[^52]: https://forums.steinberg.net/t/spectralayers-12-0-30-maintenance-update/1009891?page=2

[^53]: https://www.reddit.com/r/IsolatedTracks/comments/1cft9tf/ultimate_vocal_remover_5_settings_questions/

[^54]: https://www.instagram.com/p/DJPSbw1v37b/

[^55]: https://www.reddit.com/r/musicproduction/comments/1704kob/any_free_music_ai_stem_separators_that_are_truly/

[^56]: https://vocalremover.easeus.com/ai-article/how-to-use-ultimate-vocal-remover.html

[^57]: https://huggingface.co/spaces/abidlabs/music-separation

[^58]: https://github.com/Anjok07/ultimatevocalremovergui

[^59]: https://www.aimodels.fyi/models/replicate/demucs-cjwbw

[^60]: https://twoshot.app/model/165

[^61]: https://audiosex.pro/threads/uvr-ultimate-vocal-remover-the-question-the-journey.80898/

[^62]: https://www.kdjingpai.com/en/demucs-v4banbencaibeng/

[^63]: https://audiomuse.ai/blog/demucs-vs-ultimate

[^64]: https://github.com/Anjok07/ultimatevocalremovergui/discussions/1142

[^65]: https://github.com/sevagh/freemusicdemixer.com/discussions/13

[^66]: https://www.fosshub.com/Demucs-GUI.html

[^67]: https://www.apollotechnical.com/review-of-best-ai-vocal-remover-music-separation-tool/

[^68]: https://ieeexplore.ieee.org/document/10121418/

[^69]: https://www.apollotechnical.com/the-new-sound-of-creation-a-deep-dive-into-musiccreator-ai/

[^70]: https://www.nature.com/articles/s41598-025-20179-3

[^71]: https://github.com/JusperLee/Apollo

[^72]: https://www.isca-archive.org/interspeech_2025/sun25d_interspeech.pdf

[^73]: https://arxiv.org/html/2409.08514v2

[^74]: https://www.reddit.com/r/AI_Music/comments/1kyyo9d/instrumental_vocal_separation_stem_splitter_high/

[^75]: https://github.com/amanteur/BandSplitRNN-PyTorch

[^76]: https://uadforum.com/community/index.php?threads%2Fany-innovative-use-of-ai.78062%2F

[^77]: https://www.gaudiolab.com/gaudio-studio/blog/best-stem-2025

[^78]: https://ieeexplore.ieee.org/document/10447771/

[^79]: https://arstechnica.com/apple/2025/06/apples-ai-driven-stem-splitter-audio-separation-tech-has-hugely-improved-in-a-year/

[^80]: https://music.ai/blog/research/source-separation-benchmarks/

[^81]: https://dl.acm.org/doi/abs/10.1109/TASLP.2023.3271145

[^82]: https://www.prnewswire.com/news-releases/apollo-expands-platform-to-power-the-agentic-future-at-graphql-summit-2025-302577086.html

[^83]: https://www.bohrium.com/paper-details/scnet-sparse-compression-network-for-music-source-separation/957523764948500485-108584

[^84]: https://arxiv.org/abs/2401.13276

[^85]: https://www.emergentmind.com/topics/musdb-hq-benchmark-dataset

[^86]: https://www.isca-archive.org/interspeech_2025/yang25d_interspeech.html

[^87]: https://arxiv.org/html/2506.15514v1

[^88]: https://www.semanticscholar.org/paper/3b5b11893514e6ac9539ace2f625697ee19f6ee3

[^89]: https://www.kaggle.com/datasets/quanglvitlm/musdb18-hq

[^90]: https://gearspace.com/board/electronic-music-instruments-and-electronic-music-production/1443674-best-stem-separator-2025-a-post17566641.html

[^91]: https://www.themoonlight.io/en/review/moises-light-resource-efficient-band-split-u-net-for-music-source-separation

[^92]: https://sigsep.github.io/datasets/musdb.html

[^93]: https://dl.acm.org/doi/10.1007/978-3-031-90167-6_13

[^94]: https://github.com/Yuan-ManX/ai-audio-datasets

[^95]: https://mvsep.com/en/demo?algorithm_id=40

[^96]: https://github.com/starrytong/SCNet

[^97]: https://www.npmjs.com/package/@soundws/stem-player

[^98]: https://www.youtube.com/watch?v=nZR8QyxXqRY

[^99]: https://www.reddit.com/r/Python/comments/wjp9c7/music_source_separation_system_using_deep/

[^100]: https://stackoverflow.com/questions/76096551/how-to-get-wav-audio-from-a-microphone-in-go

[^101]: https://stackoverflow.com/questions/26445011/create-volume-control-for-web-audio

[^102]: https://transloadit.com/devtips/generate-and-visualize-audio-waveforms-using-go/

[^103]: https://source-separation.github.io/tutorial/data/scaper.html

[^104]: https://pkg.go.dev/github.com/go-audio/wav

[^105]: https://librosa.org/doc/main/auto_examples/plot_vocal_separation.html

[^106]: https://w3schools.invisionzone.com/topic/54137-using-volume-in-the-html-audio-tag/

[^107]: https://github.com/faiface/beep

[^108]: https://www.youtube.com/watch?v=MgpPkVttIUY

[^109]: https://www.reddit.com/r/learnjavascript/comments/1b5qzt8/web_audio_api_gain_issues/

[^110]: https://stackoverflow.com/questions/50594972/manage-multiple-audio-sources-in-react

[^111]: https://huggingface.co/docs/transformers/en/model_doc/roformer

[^112]: https://github.com/joshwcomeau/use-sound

[^113]: https://rabzelj.com/blog/roformer-enhanced-transformer-with-rotary-position-embedding-paper-notes

[^114]: https://dev.to/blamsa0mine/-build-your-own-music-player-in-react-with-context-api-and-typescript-2hg3

[^115]: https://github.com/facebookresearch/demucs/issues/486

[^116]: https://github.com/ZFTurbo/Music-Source-Separation-Training

[^117]: https://blog.logrocket.com/building-audio-player-react/

[^118]: https://pypi.org/project/BS-RoFormer/

[^119]: https://www.reddit.com/r/learnreactjs/comments/shh7le/play_array_of_audio_files_using_react_player/

[^120]: https://docs.pytorch.org/audio/2.5.0/tutorials/hybrid_demucs_tutorial.html

[^121]: https://huggingface.co/docs/transformers/model_doc/reformer

[^122]: https://dev.to/ma5ly/lets-make-a-little-audio-player-in-react-p4p

