"""Local audio processing logic."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine
from src.db.models import AudioFile, Profile, Recording

from ..config import Config
from ..models.metadata import StemsMetadata
from ..processor.core import (
    convert_stems_to_final_format,
    detect_clips,
    separate_to_wav,
)
from ..processor.models import (
    ClipBoundary,
    ProcessingCallbackPayload,
    StemData,
    StemDataModel,
)
from ..storage import get_storage


async def process_locally(recording_id: UUID, config: Config) -> None:
    """
    Processes a recording locally. This function is idempotent and can be re-run.
    """
    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as session:
        callback_url = ""  # Will be set after fetching recording
        try:
            # Step 0: Fetch recording
            stmt = select(Recording).where(Recording.id == recording_id)
            result = await session.exec(stmt)
            recording = result.first()

            if not recording:
                raise ValueError(f"Recording with ID {recording_id} not found.")

            # Fetch profile separately
            profile_stmt = select(Profile).where(Profile.id == recording.profile_id)
            profile_result = await session.exec(profile_stmt)
            profile = profile_result.first()

            if not profile:
                raise ValueError(f"Profile not found for recording {recording_id}.")

            # Fetch audio file separately
            audio_file_stmt = select(AudioFile).where(AudioFile.id == recording.audio_file_id)
            audio_file_result = await session.exec(audio_file_stmt)
            audio_file = audio_file_result.first()

            if not audio_file:
                raise ValueError(f"Audio file not found for recording {recording_id}.")

            if not recording.verification_token:
                raise ValueError(f"Recording {recording_id} has no verification token.")

            callback_url = f"{config.backend_url}/api/recordings/{recording_id}/complete/{recording.verification_token}"
            output_dir = Path("media") / profile.name / recording.output_name
            storage = get_storage(config)
            input_path = Path(storage.get_input_url(profile.name, audio_file.filename))

            # Step 1: Separation
            # Check if we can use cached separation results
            stems_metadata: StemsMetadata | None = None  # Will be set below
            can_use_cached_separation = False
            if recording.separated_at and recording.stems_metadata_json:
                # Verify all WAV files referenced in metadata still exist
                cached_metadata = StemsMetadata(**recording.stems_metadata_json)  # pyright: ignore[reportAny]
                all_wavs_exist = all(
                    (output_dir / stem_meta.stem_url).exists()
                    and (output_dir / stem_meta.stem_url).suffix.lower() == ".wav"
                    for stem_meta in cached_metadata.stems.values()
                )
                if all_wavs_exist:
                    can_use_cached_separation = True
                    print(f"[{recording.id}] Using cached separation (all WAV files exist).")
                    stems_metadata = cached_metadata
                else:
                    print(f"[{recording.id}] WAV files missing, re-running separation...")

            if not can_use_cached_separation:
                print(f"[{recording.id}] Running separation...")
                stems_metadata = await separate_to_wav(
                    input_path=input_path,
                    output_dir=output_dir,
                    profile_name=profile.name,
                    strategy_name=profile.strategy_name,
                )
                recording.stems_metadata_json = stems_metadata.model_dump()
                recording.separated_at = datetime.now(timezone.utc)
                await session.commit()
                print(f"[{recording.id}] Separation complete.")

            # At this point, stems_metadata is guaranteed to be set
            assert stems_metadata is not None  # noqa: S101

            # Step 2: Clip detection
            if not recording.clips_detected_at or not recording.clip_boundaries_json:
                print(f"[{recording.id}] Detecting clip boundaries...")
                clip_boundaries = detect_clips(stems_metadata, output_dir)
                recording.clip_boundaries_json = {
                    k: v.model_dump() for k, v in clip_boundaries.items()
                }
                recording.clips_detected_at = datetime.now(timezone.utc)
                await session.commit()
                print(f"[{recording.id}] Clip detection complete.")
            else:
                print(f"[{recording.id}] Skipping clip detection (already done).")
                clip_boundaries = {
                    k: ClipBoundary(**v)  # pyright: ignore[reportAny]
                    for k, v in (recording.clip_boundaries_json or {}).items()  # pyright: ignore[reportAny]
                }

            # Step 3: Format conversion
            final_stems_metadata = stems_metadata.model_copy(deep=True)
            if not recording.converted_at:
                final_stems_metadata = convert_stems_to_final_format(
                    stems_metadata,
                    output_dir,
                    profile.output,
                    delete_intermediate_wavs=False,
                )
                if profile.output.format.value.lower() != "wav":
                    recording.converted_at = datetime.now(timezone.utc)
                    await session.commit()
            else:
                # If already converted, we still need to construct the final metadata
                # with the correct (non-WAV) extension for the callback.
                for stem_meta in final_stems_metadata.stems.values():
                    stem_meta.stem_url = (
                        Path(stem_meta.stem_url)
                        .with_suffix(f".{profile.output.format.value.lower()}")
                        .name
                    )

            # Step 4: Upload to R2 is handled by `uv run stemset sync`
            print(f"[{recording.id}] Skipping R2 upload (handled by sync command).")

            # Step 5: Prepare and send callback
            stem_data_list: list[StemData] = []
            duration = final_stems_metadata.duration
            for stem_name, stem_meta in final_stems_metadata.stems.items():
                audio_path = output_dir / stem_meta.stem_url
                file_size_bytes = audio_path.stat().st_size if audio_path.exists() else 0

                stem_data_list.append(
                    StemData(
                        stem_type=stem_name,
                        measured_lufs=stem_meta.measured_lufs,
                        peak_amplitude=stem_meta.peak_amplitude,
                        stem_gain_adjustment_db=stem_meta.stem_gain_adjustment_db,
                        audio_url=stem_meta.stem_url,
                        waveform_url=stem_meta.waveform_url,
                        file_size_bytes=file_size_bytes,
                        duration_seconds=duration,
                    )
                )

            callback_payload = ProcessingCallbackPayload(
                status="complete",
                stems=[StemDataModel(**stem) for stem in stem_data_list],
                clip_boundaries=clip_boundaries,
            )

            print(f"[{recording.id}] Calling back to: {callback_url}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(callback_url, json=callback_payload.model_dump())
                _ = response.raise_for_status()

            print(f"[Local Worker] Recording {recording_id} complete")

        except Exception as e:
            print(f"[Local Worker] Recording {recording_id} failed: {e}")
            # We must fetch the recording again in a new transaction to update it
            async with AsyncSession(engine, expire_on_commit=False) as error_session:
                result = await error_session.exec(
                    select(Recording).where(Recording.id == recording_id)
                )
                recording = result.first()
                if recording:
                    recording.status = "error"
                    recording.error_message = str(e)
                    await error_session.commit()

            # Try to call back with error
            try:
                callback_payload = ProcessingCallbackPayload(status="error", error=str(e))
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(callback_url, json=callback_payload.model_dump())
                    _ = response.raise_for_status()
            except Exception as callback_error:
                print(f"[Local Worker] Failed to report error: {callback_error}")
