"""Configuration management for Stemset."""

import yaml
from pathlib import Path
from enum import Enum
from pydantic import BaseModel, Field, field_validator


class StemGains(BaseModel):
    """Per-stem gain adjustments in dB."""

    vocals: float = 0.0
    drums: float = 0.0
    bass: float = 0.0
    other: float = 0.0


class ModelType(str, Enum):
    """Enum for available separation model types."""
    
    DEMUCS = "demucs"
    HDEMUCS_MMI = "hdemucs_mmi"
    SUCCESSIVE = "successive"
        
    @classmethod
    def get_available_models(cls) -> list[str]:
        """Get a list of all available model names."""
        return [model.value for model in cls]
    
    @classmethod
    def get_default_model(cls) -> "ModelType":
        """Get the default model type."""
        return cls.DEMUCS


class Profile(BaseModel):
    """A processing profile with source folder and settings."""

    name: str = Field(..., description="Profile name (unique identifier)")
    source_folder: str = Field(..., description="Path to folder containing audio files")
    model: ModelType = Field(
        default=ModelType.DEMUCS, 
        description=f"Separation model to use. Available: {', '.join(ModelType.get_available_models())}"
    )
    target_lufs: float = Field(
        -23.0, description="Target loudness in LUFS for normalization"
    )
    stem_gains: StemGains = Field(
        default_factory=StemGains,
        description="Per-stem gain adjustments in dB (applied after normalization)",
    )
    output_format: str = Field(
        "opus", description="Output format for stems: 'wav' or 'opus'"
    )
    opus_bitrate: int = Field(
        192, description="Opus bitrate in kbps (96-512, recommended: 128-256 for music)"
    )

    @field_validator("source_folder")
    @classmethod
    def validate_source_folder(cls, v: str) -> str:
        """Expand and validate source folder path."""
        path = Path(v).expanduser().resolve()
        return str(path)

    def get_source_path(self) -> Path:
        """Get source folder as Path object."""
        return Path(self.source_folder)

    def get_media_path(self) -> Path:
        """Get the media output path for this profile."""
        return Path("media") / self.name

    def get_stem_gain(self, stem_name: str) -> float:
        """Get the gain adjustment for a specific stem in dB."""
        return getattr(self.stem_gains, stem_name, 0.0)


class Config(BaseModel):
    """Global configuration."""

    profiles: list[Profile] = Field(
        default_factory=list, description="List of processing profiles"
    )

    @classmethod
    def load(cls, config_path: str = "config.yaml") -> "Config":
        """Load configuration from YAML file."""
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        with open(path, "r") as f:
            data = yaml.safe_load(f)

        return cls(**data)

    def get_profile(self, name: str) -> Profile | None:
        """Get a profile by name."""
        for profile in self.profiles:
            if profile.name == name:
                return profile
        return None

    def get_profile_names(self) -> list[str]:
        """Get list of all profile names."""
        return [p.name for p in self.profiles]


# Global config instance
_config: Config | None = None


def load_config(config_path: str = "config.yaml") -> Config:
    """Load and cache the global configuration."""
    global _config
    _config = Config.load(config_path)
    return _config


def get_config() -> Config:
    """Get the cached configuration (loads if not already loaded)."""
    global _config
    if _config is None:
        _config = load_config()
    return _config
