#!/usr/bin/env python3
"""Regenerate metadata.json files with relative URLs for stems and waveforms."""

from __future__ import annotations

import sys
from pathlib import Path

# Add parent directory to path to import config
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

from src.config import load_config
from src.models.metadata import StemMetadata, StemsMetadata


def main() -> None:
    """Regenerate all metadata.json files."""
    load_dotenv()
    config = load_config()

    for profile in config.profiles:
        media_path = profile.get_media_path()
        if not media_path.exists():
            print(f"Skipping profile '{profile.name}' - media path doesn't exist")
            continue

        print(f"\nProcessing profile: {profile.name}")

        # Find all directories with metadata.json
        for song_dir in media_path.iterdir():
            if not song_dir.is_dir():
                continue

            metadata_file = song_dir / "metadata.json"
            if not metadata_file.exists():
                continue

            print(f"  Updating {song_dir.name}/metadata.json")

            # Load existing metadata as JSON (old format may not have stem_url)
            import json
            with open(metadata_file) as f:
                old_data = json.load(f)

            old_stems = old_data.get("stems", old_data)

            # Create new metadata with relative URLs
            new_stems = {}
            for stem_name, stem_meta in old_stems.items():
                # Find the audio file for this stem
                stem_file = None
                for ext in [".opus", ".wav"]:
                    candidate = song_dir / f"{stem_name}{ext}"
                    if candidate.exists():
                        stem_file = candidate
                        break

                if not stem_file:
                    print(f"    Warning: No audio file found for stem '{stem_name}'")
                    continue

                # Create new metadata with relative paths
                new_stems[stem_name] = StemMetadata(
                    stem_type=stem_meta["stem_type"],
                    measured_lufs=stem_meta["measured_lufs"],
                    peak_amplitude=stem_meta["peak_amplitude"],
                    stem_gain_adjustment_db=stem_meta["stem_gain_adjustment_db"],
                    stem_url=stem_file.name,  # e.g., "vocals.opus"
                    waveform_url=f"{stem_name}_waveform.png",
                )
                print(f"    ✓ {stem_name}: {stem_file.name}")

            # Write updated metadata
            updated_metadata = StemsMetadata(stems=new_stems)
            updated_metadata.to_file(metadata_file)

    print("\n✅ All metadata.json files updated!")


if __name__ == "__main__":
    main()
