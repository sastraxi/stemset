import type { StemResponse } from "./api/generated/types.gen";

// ============================================================================
// Audio Layer Types (Web Audio API, derived from metadata)
// ============================================================================

export interface StemAudioData {
	buffer: AudioBuffer;
	metadata: StemResponse;
}

export interface StemAudioNode {
	buffer: AudioBuffer;
	gainNode: GainNode;
	eqLowNode: BiquadFilterNode; // Low-shelf filter
	eqMidNode: BiquadFilterNode; // Peaking filter for mids
	eqHighNode: BiquadFilterNode; // High-shelf filter
	compressorNode: DynamicsCompressorNode;
	outputGainNode: GainNode;
	initialGain: number; // Computed from metadata.stem_gain_adjustment_db
}

// ============================================================================
// Effects Configuration Types (used in audio effects hooks)
// ============================================================================

export interface CompressorConfig {
	threshold: number; // dB, -48 to 0
	attack: number; // seconds, 0.001 to 0.05
	hold: number; // seconds, 0.001 to 0.1
	release: number; // seconds, 0.01 to 1.0
	enabled: boolean;
}

export interface ParametricEqBandConfig {
	frequency: number; // Hz
	gain: number; // dB, -12 to +12
	q: number; // 0.3 to 8 (logarithmic scale)
}

export interface ParametricEqConfig {
	lowBand: ParametricEqBandConfig; // 20-500Hz
	midBand: ParametricEqBandConfig; // 200-5000Hz
	highBand: ParametricEqBandConfig; // 1000-20000Hz
	enabled: boolean;
}

export const IMPULSES = {
	"sparkling-hall": "Sparkling Hall",
	"ambience-close-mic": "Ambience Close Mic",
	"ambience-with-punch": "Ambience with Punch",
	"arena-south-west": "Arena South West",
	"big-bright-room": "Big Bright Room",
	"gothic-church": "Gothic Church",
	"in-the-silo-revised": "In the Silo (Revised)",
	"masonic-lodge": "Masonic Lodge",
	"nice-drum-room": "Nice Drum Room",
	"onewall-on-a-room": "One Wall on a Room",
	"ruby-room": "Ruby Room",
	"scala-milan-opera-hall": "Scala Milan Opera Hall",
	"small-studio": "Small Studio",
	"stonewall-room": "Stonewall Room",
};

export type ImpulseName = keyof typeof IMPULSES;

export interface ReverbConfig {
	impulse: ImpulseName; // impulse response name (e.g., 'sparkling-hall')
	mix: number; // 0 to 1 (wet/dry)
	enabled: boolean;
}

export interface StereoExpanderConfig {
	lowMidCrossover: number; // Hz, 50 to 2000
	midHighCrossover: number; // Hz, 800 to 12000
	expLow: number; // 0.5 to 2.0 (1.0 = unchanged)
	compLow: number; // 0 to 1
	expMid: number; // 0.5 to 2.0
	compMid: number; // 0 to 1
	expHigh: number; // 0.5 to 2.0
	compHigh: number; // 0 to 1
	enabled: boolean;
}

// ============================================================================
// User Config Types (mutable, persisted to localStorage)
// ============================================================================

export interface EqBand {
	id: string;
	frequency: number;
	type: BiquadFilterType;
	gain: number;
	q: number;
}

export interface EqConfig {
	bands: EqBand[];
	enabled: boolean;
}

export type StemCompressionLevel = "off" | "low" | "medium" | "high";
export type StemEqLevel = "off" | "low" | "medium" | "high";

export interface StemUserConfig {
	gain: number; // Volume slider value (0-2)
	muted: boolean; // Mute button state
	soloed: boolean; // Solo button state
	compression: StemCompressionLevel; // Compression level
	eqLow: StemEqLevel; // Low-shelf EQ
	eqMid: StemEqLevel; // Mid-band EQ
	eqHigh: StemEqLevel; // High-shelf EQ
}

export interface EffectsChainConfig {
	parametricEq: ParametricEqConfig;
	eq: EqConfig;
	compressor: CompressorConfig;
	reverb: ReverbConfig;
	stereoExpander: StereoExpanderConfig;
	// Future: order: Array<'parametricEq' | 'eq' | 'compressor' | 'reverb' | 'stereoExpander'>;
}

export interface RecordingUserConfig {
	playbackPosition: number;
	stems: Record<string, StemUserConfig>;
	effects: EffectsChainConfig;
}

// ============================================================================
// View Model Types (UI layer, combines metadata + user config)
// ============================================================================

export interface StemViewModel {
	// Identity
	name: string;

	// From metadata (immutable)
	stemType: string;
	waveformUrl: string;
	initialGain: number;

	// From user config (mutable)
	gain: number;
	muted: boolean;
	soloed: boolean;
	compression: StemCompressionLevel;
	eqLow: StemEqLevel;
	eqMid: StemEqLevel;
	eqHigh: StemEqLevel;
}
