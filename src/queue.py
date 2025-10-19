"""Processing queue for stem separation jobs."""

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional


class JobStatus(str, Enum):
    """Status of a processing job."""

    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    """A stem separation job."""

    id: str
    profile_name: str
    input_file: Path
    output_folder: Path
    status: JobStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    output_files: Optional[dict] = None


class ProcessingQueue:
    """Queue for managing stem separation jobs."""

    def __init__(self):
        """Initialize the processing queue."""
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue = asyncio.Queue()
        self.current_job: Optional[Job] = None
        self.processing_task: Optional[asyncio.Task] = None
        self._job_counter = 0

    def _generate_job_id(self) -> str:
        """Generate a unique job ID."""
        self._job_counter += 1
        timestamp = int(time.time() * 1000)
        return f"job_{timestamp}_{self._job_counter}"

    def add_job(self, profile_name: str, input_file: Path, output_folder: Path) -> Job:
        """Add a new job to the queue.

        Args:
            profile_name: Name of the profile being used
            input_file: Path to input audio file
            output_folder: Path to output folder for stems

        Returns:
            The created job
        """
        job_id = self._generate_job_id()
        job = Job(
            id=job_id,
            profile_name=profile_name,
            input_file=input_file,
            output_folder=output_folder,
            status=JobStatus.QUEUED,
            created_at=datetime.now(),
        )
        self.jobs[job_id] = job
        self.queue.put_nowait(job)
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID.

        Args:
            job_id: The job ID

        Returns:
            The job, or None if not found
        """
        return self.jobs.get(job_id)

    def get_all_jobs(self) -> list[Job]:
        """Get all jobs.

        Returns:
            List of all jobs
        """
        return list(self.jobs.values())

    def get_jobs_by_profile(self, profile_name: str) -> list[Job]:
        """Get all jobs for a specific profile.

        Args:
            profile_name: The profile name

        Returns:
            List of jobs for the profile
        """
        return [job for job in self.jobs.values() if job.profile_name == profile_name]

    def get_queue_size(self) -> int:
        """Get the number of queued jobs.

        Returns:
            Number of jobs in queue
        """
        return self.queue.qsize()

    def is_processing(self) -> bool:
        """Check if a job is currently being processed.

        Returns:
            True if a job is being processed
        """
        return self.current_job is not None

    async def start_processing(self, processor_callback) -> None:
        """Start the queue processor.

        Args:
            processor_callback: Async function to call for each job.
                                Should accept (job, profile) and return dict of output files.
        """
        if self.processing_task is not None:
            return  # Already running

        async def process_queue():
            while True:
                try:
                    # Get next job from queue
                    job = await self.queue.get()
                    self.current_job = job

                    # Update job status
                    job.status = JobStatus.PROCESSING
                    job.started_at = datetime.now()

                    try:
                        # Process the job
                        output_files = await processor_callback(job)

                        # Mark as completed
                        job.status = JobStatus.COMPLETED
                        job.completed_at = datetime.now()
                        job.output_files = output_files

                        print(f"Job {job.id} completed successfully")

                    except Exception as e:
                        # Mark as failed
                        job.status = JobStatus.FAILED
                        job.completed_at = datetime.now()
                        job.error = str(e)

                        print(f"Job {job.id} failed: {e}")

                    finally:
                        self.current_job = None
                        self.queue.task_done()

                except asyncio.CancelledError:
                    break
                except Exception as e:
                    print(f"Error in queue processor: {e}")

        self.processing_task = asyncio.create_task(process_queue())

    async def stop_processing(self) -> None:
        """Stop the queue processor."""
        if self.processing_task is not None:
            self.processing_task.cancel()
            try:
                await self.processing_task
            except asyncio.CancelledError:
                pass
            self.processing_task = None


# Global queue instance
_queue: Optional[ProcessingQueue] = None


def get_queue() -> ProcessingQueue:
    """Get the global processing queue."""
    global _queue
    if _queue is None:
        _queue = ProcessingQueue()
    return _queue
