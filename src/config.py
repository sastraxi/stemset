# pyright: reportExplicitAny=false
"""Configuration management for Stemset."""

from __future__ import annotations

import os
import re
from enum import Enum
from pathlib import Path
from typing import Any, cast

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator


class AudioFormat(str, Enum):
    """Supported audio output formats."""

    WAV = "wav"
    OPUS = "opus"
    AAC = "aac"


class OutputConfig(BaseModel):
    """Output format configuration."""

    format: AudioFormat = AudioFormat.OPUS
    bitrate: int = 192

    @field_validator("bitrate")
    @classmethod
    def validate_bitrate(cls, v: int) -> int:
        """Validate bitrate is within acceptable range."""
        if not 32 <= v <= 256:
            raise ValueError(f"Bitrate must be between 32 and 256 kbps, got {v}")
        return v


class StrategyNode(BaseModel):
    """A node in the separation strategy tree."""

    model: str = Field(..., description="Model name to use for separation")
    outputs: dict[str, str | StrategyNode] = Field(
        default_factory=dict,
        description="Output slot mappings (slot_name -> final_name or subtree)",
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
        description="OAuth redirect URI (update for production)",
    )


class R2Config(BaseModel):
    """Cloudflare R2 storage configuration."""

    account_id: str = Field(..., description="Cloudflare account ID")
    access_key_id: str = Field(..., description="R2 access key ID")
    secret_access_key: str = Field(..., description="R2 secret access key")
    bucket_name: str = Field(..., description="R2 bucket name for media files")
    public_url: str | None = Field(
        default=None, description="Public R2 bucket URL (if configured for public access)"
    )


class Config(BaseModel):
    """Global configuration."""

    strategies: dict[str, Strategy] = Field(
        default_factory=dict, description="Available separation strategies"
    )
    auth: AuthConfig | None = Field(
        default=None, description="Authentication configuration (optional)"
    )
    r2: R2Config | None = Field(
        default=None, description="Cloudflare R2 storage configuration (optional)"
    )
    gpu_worker_url: str | None = Field(
        default=None, description="URL of GPU worker service for remote processing (optional)"
    )

    @model_validator(mode="after")
    def validate_gpu_worker_requires_r2(self) -> Config:
        """Validate that R2 config is present if GPU worker URL is set."""
        # Check both config.yaml value and environment variable
        gpu_worker_url = self.gpu_worker_url or os.getenv("GPU_WORKER_URL")

        if gpu_worker_url and self.r2 is None:
            msg = (
                "GPU_WORKER_URL is set but R2 configuration is missing.\n"
                "Remote GPU processing requires R2 storage for file transfer.\n"
                "Either:\n"
                "  1. Add 'r2:' section to config.yaml with R2 credentials, or\n"
                "  2. Unset GPU_WORKER_URL to use local processing with local storage"
            )
            raise ValueError(msg)

        return self

    @classmethod
    def _collect_required_env_vars(cls, data: Any, collected: set[str] | None = None) -> set[str]:
        """Recursively collect all ${VAR_NAME} references from config data.

        Args:
            data: YAML data structure (dict, list, str, etc.)
            collected: Set of variable names found so far

        Returns:
            Set of all environment variable names referenced in config
        """
        if collected is None:
            collected = set()

        if isinstance(data, dict):
            for v in data.values():
                cls._collect_required_env_vars(v, collected)
        elif isinstance(data, list):
            for item in data:
                cls._collect_required_env_vars(item, collected)
        elif isinstance(data, str):
            # Find all ${VAR_NAME} patterns
            pattern = r"\$\{([^}]+)\}"
            matches = re.findall(pattern, data)
            collected.update(matches)

        return collected

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
            pattern = r"\$\{([^}]+)\}"

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
        """Load configuration from YAML file.

        Note: Assumes environment variables are already loaded (e.g., via load_dotenv()).
        """
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found: {config_path}")

        with open(path, "r") as f:
            data: dict[str, Any] = yaml.safe_load(f)

        # Validate environment variables for enabled sections only
        # Only check env vars for sections that are present and not None
        required_vars: set[str] = set()

        # Always check R2 if present
        if data.get("r2") is not None:
            required_vars.update(cls._collect_required_env_vars(data["r2"]))

        # Always check GPU worker URL if present
        if data.get("gpu_worker_url") is not None:
            required_vars.update(cls._collect_required_env_vars(data["gpu_worker_url"]))

        # Always check auth if present
        if data.get("auth") is not None:
            required_vars.update(cls._collect_required_env_vars(data["auth"]))

        # Check other top-level sections
        for key in ["strategies"]:
            if data.get(key) is not None:
                required_vars.update(cls._collect_required_env_vars(data[key]))

        missing_vars = [var for var in required_vars if var not in os.environ]

        if missing_vars:
            raise ValueError(
                f"Missing required environment variables: {', '.join(sorted(missing_vars))}\n"
                + "Please set these in your .env file or environment.\n"
                + "See .env.example for reference."
            )

        # Substitute environment variables
        data = cls._substitute_env_vars(data)

        # Parse strategies from YAML
        strategies_dict: dict[str, Strategy] = {}
        if "strategies" in data:
            for strategy_name, strategy_data in data["strategies"].items():
                strategies_dict[strategy_name] = Strategy.from_dict(strategy_name, strategy_data)
            data["strategies"] = strategies_dict

        config = cls(**data)

        # Note: Strategy output slot validation happens at execution time
        # in StrategyExecutor, where we have the actual model instances

        return config

    def get_strategy(self, name: str) -> Strategy | None:
        """Get a strategy by name."""
        return self.strategies.get(name)


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
