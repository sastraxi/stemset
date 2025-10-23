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
  metadata_url: string;
}

export interface StemMetadata {
  stem_type: string;
  measured_lufs: number | null;
  peak_amplitude: number;
  stem_gain_adjustment_db: number;
  waveform_url: string;
}
