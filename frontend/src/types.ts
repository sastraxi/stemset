export interface Profile {
  name: string;
  source_folder: string;
  target_lufs: number;
  stem_gains: {
    vocals: number;
    drums: number;
    bass: number;
    other: number;
  };
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
  original_lufs: number;
  target_lufs: number;
  normalization_gain_db: number;
  stem_gain_adjustment_db: number;
  total_gain_db: number;
  stem_type: string;
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
