# pyright: reportExplicitAny=false
"""Configuration management for Stemset."""

from __future__ import annotations

import os
import re
import yaml
from datetime import datetime
from enum import Enum
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Any, cast


class JobStatus(str, Enum):
    """Status of a processing job."""

    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Job(BaseModel):
    """A stem separation job."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    id: str
    profile_name: str
    input_file: Path
    output_folder: Path
    status: JobStatus
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    output_files: dict[str, str] | None = None


class OutputConfig(BaseModel):
    """Output format configuration."""

    format: str = Field("opus", description="Output format: 'wav' or 'opus'")
    bitrate: int = Field(192, description="Bitrate in kbps for lossy formats (e.g., Opus)")

    @field_validator("format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        """Validate output format."""
        allowed = {"wav", "opus"}
        if v.lower() not in allowed:
            raise ValueError(f"Invalid format '{v}'. Must be one of: {', '.join(allowed)}")
        return v.lower()


class StrategyNode(BaseModel):
    """A node in the separation strategy tree."""

    model: str = Field(..., description="Model name to use for separation")
    outputs: dict[str, str | StrategyNode] = Field(
        default_factory=dict, description="Output slot mappings (slot_name -> final_name or subtree)"
    )

    @model_validator(mode="before")
    @classmethod
    def extract_outputs(cls, data: Any) -> dict[str, Any]:
        """Extract model and outputs from YAML structure."""
        if not isinstance(data, dict):
            raise ValueError("Strategy node must be a dictionary")

        dict_data = cast(dict[str, Any], data)

        # If already processed (has 'model' key), return as-is
        if "model" in dict_data:
            return dict_data

        # Extract from YAML format (with '_' key)
        if "_" not in dict_data:
            raise ValueError("Strategy node must have '_' key specifying model name")

        model_name = cast(str, dict_data["_"])
        outputs = {k: v for k, v in dict_data.items() if k != "_"}

        return {"model": model_name, "outputs": outputs}

    def validate_outputs(self, expected_slots: set[str]) -> None:
        """Validate that output slots match model's expected slots.

        Args:
            expected_slots: Set of slot names the model produces

        Raises:
            ValueError: If output slots don't match expected slots
        """
        actual_slots = set(self.outputs.keys())

        if actual_slots != expected_slots:
            missing = expected_slots - actual_slots
            extra = actual_slots - expected_slots
            errors = []
            if missing:
                errors.append(f"missing slots: {missing}")
            if extra:
                errors.append(f"unexpected slots: {extra}")
            raise ValueError(
                f"Model '{self.model}' output mismatch: {', '.join(errors)}. " +
                f"Expected: {expected_slots}"
            )

    def get_final_outputs(self) -> set[str]:
        """Get all final output names from this tree."""
        final_outputs = set()
        for output_value in self.outputs.values():
            if isinstance(output_value, str):
                # Leaf node - final output name
                final_outputs.add(output_value)
            elif isinstance(output_value, StrategyNode):
                # Subtree - recurse
                final_outputs.update(output_value.get_final_outputs())
        return final_outputs


class Strategy(BaseModel):
    """A separation strategy defining a tree of models."""

    name: str = Field(..., description="Strategy name (unique identifier)")
    root: StrategyNode = Field(..., description="Root node of strategy tree")

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> Strategy:
        """Create strategy from YAML dictionary."""
        root = StrategyNode.model_validate(data)
        return cls(name=name, root=root)


class AuthConfig(BaseModel):
    """Authentication configuration."""

    allowed_emails: list[str] = Field(..., description="List of allowed email addresses")
    google_client_id: str = Field(..., description="Google OAuth client ID")
    google_client_secret: str = Field(..., description="Google OAuth client secret")
    jwt_secret: str = Field(..., description="Secret key for JWT signing")
    redirect_uri: str = Field(
        default="http://localhost:8000/auth/callback",
        description="OAuth redirect URI (update for production)"
    )


class Profile(BaseModel):
    """A processing profile with source folder and settings."""

    name: str = Field(..., description="Profile name (unique identifier)")
    source_folder: str = Field(..., description="Path to folder containing audio files")
    strategy: str = Field(..., description="Strategy name to use for separation")
    output: OutputConfig = Field(default_factory=lambda: OutputConfig(), description="Output format configuration")

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


class Config(BaseModel):
    """Global configuration."""

    strategies: dict[str, Strategy] = Field(
        default_factory=dict, description="Available separation strategies"
    )
    profiles: list[Profile] = Field(
        default_factory=list, description="List of processing profiles"
    )
    auth: AuthConfig | None = Field(
        default=None, description="Authentication configuration (optional)"
    )

    @classmethod
    def _substitute_env_vars(cls, data: Any) -> Any:
        """Recursively substitute ${VAR_NAME} with environment variables.

        Args:
            data: YAML data structure (dict, list, str, etc.)

        Returns:
            Data with environment variables substituted

        Raises:
            ValueError: If referenced environment variable is not set
        """
        if isinstance(data, dict):
            return {k: cls._substitute_env_vars(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [cls._substitute_env_vars(item) for item in data]
        elif isinstance(data, str):
            # Replace ${VAR_NAME} with environment variable
            pattern = r'\$\{([^}]+)\}'

            def replace_var(match: re.Match[str]) -> str:
                var_name = match.group(1)
                value = os.getenv(var_name)
                if value is None:
                    raise ValueError(
                        f"Environment variable '{var_name}' referenced in config but not set"
                    )
                return value

            return re.sub(pattern, replace_var, data)
        else:
            return data

    @classmethod
    def load(cls, config_path: str = "config.yaml") -> Config:
        """Load configuration from YAML file."""
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        with open(path, "r") as f:
            data: dict[str, Any] = yaml.safe_load(f)

        # Substitute environment variables
        data = cls._substitute_env_vars(data)

        # Parse strategies from YAML
        strategies_dict = {}
        if "strategies" in data:
            for strategy_name, strategy_data in data["strategies"].items():
                strategies_dict[strategy_name] = Strategy.from_dict(strategy_name, strategy_data)
            data["strategies"] = strategies_dict

        config = cls(**data)

        # Validate profile strategy references
        for profile in config.profiles:
            if profile.strategy not in config.strategies:
                available = ", ".join(config.strategies.keys())
                raise ValueError(
                    f"Profile '{profile.name}' references unknown strategy '{profile.strategy}'. " +
                    f"Available strategies: {available}"
                )

        # Note: Strategy output slot validation happens at execution time
        # in StrategyExecutor, where we have the actual model instances

        return config

    def get_strategy(self, name: str) -> Strategy | None:
        """Get a strategy by name."""
        return self.strategies.get(name)

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
