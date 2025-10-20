export interface Profile {
  name: string;
  source_folder: string;
}

export interface StemFile {
  name: string;
  path: string;
  stems: {
    vocals?: string;
    drums?: string;
    bass?: string;
    other?: string;
  };
}

export interface StemMetadata {
  stem_type: string;
  measured_lufs: number | null;
  stem_gain_adjustment_db: number;
  waveform_url: string;
}

export interface Job {
  id: string;
  profile: string;
  input_file: string;
  output_folder: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  output_files: Record<string, string> | null;
}

export interface QueueStatus {
  queue_size: number;
  is_processing: boolean;
  current_job: {
    id: string;
    profile: string;
    input_file: string;
    status: string;
    started_at: string | null;
  } | null;
}
