export interface Profile {
  name: string;
  source_folder: string;
}

export interface StemFile {
  name: string;
  metadata_url: string;
}

export interface StemFileWithDisplayName extends StemFile {
  displayName: string; // Computed from metadata or defaults to name
}

export interface StemMetadata {
  stem_type: string;
  measured_lufs: number | null;
  peak_amplitude: number;
  stem_gain_adjustment_db: number;
  stem_url: string;  // Relative URL to audio file
  waveform_url: string;  // Relative URL to waveform PNG
}

export interface StemsMetadata {
  stems: Record<string, StemMetadata>;
  display_name: string;
}
