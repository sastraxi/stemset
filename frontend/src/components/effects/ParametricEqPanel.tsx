import type { ParametricEqBandConfig, ParametricEqConfig } from "@/types";
import { VerticalDragControl } from "../VerticalDragControl";

// Props for ParametricEqPanel component
export interface ParametricEqPanelProps {
	config: ParametricEqConfig;
	onUpdate: (
		band: "lowBand" | "midBand" | "highBand",
		changes: Partial<ParametricEqBandConfig>,
	) => void;
	onSetEnabled: (enabled: boolean) => void;
	onReset: () => void;
}

/**
 * Format frequency value for display
 */
function formatFrequency(hz: number): string {
	if (hz >= 1000) {
		return `${(hz / 1000).toFixed(1)}kHz`;
	}
	return `${Math.round(hz)}Hz`;
}

/**
 * Format Q value for display
 */
function formatQ(q: number): string {
	return `Q: ${q.toFixed(1)}`;
}

/**
 * Format gain in dB
 */
function formatGain(gain: number): string {
	return gain >= 0 ? `+${gain.toFixed(1)}dB` : `${gain.toFixed(1)}dB`;
}

interface ParametricBandProps {
	bandName: string;
	bandConfig: ParametricEqBandConfig;
	bandKey: "lowBand" | "midBand" | "highBand";
	freqMin: number;
	freqMax: number;
	onUpdate: (
		band: "lowBand" | "midBand" | "highBand",
		changes: Partial<ParametricEqBandConfig>,
	) => void;
}

function ParametricBand({
	bandName,
	bandConfig,
	bandKey,
	freqMin,
	freqMax,
	onUpdate,
}: ParametricBandProps) {
	// Convert frequency to/from logarithmic scale for slider
	const freqToLinear = (freq: number): number => {
		const logMin = Math.log10(freqMin);
		const logMax = Math.log10(freqMax);
		const logFreq = Math.log10(freq);
		return (logFreq - logMin) / (logMax - logMin);
	};

	const linearToFreq = (linear: number): number => {
		const logMin = Math.log10(freqMin);
		const logMax = Math.log10(freqMax);
		const logFreq = logMin + linear * (logMax - logMin);
		return 10 ** logFreq;
	};

	return (
		<div className="parametric-band">
			{/* Left column: Q control */}
			<div className="parametric-band-q">
				<VerticalDragControl
					value={bandConfig.q}
					min={0.3}
					max={8}
					onChange={(q) => onUpdate(bandKey, { q })}
					label="Q"
					formatValue={formatQ}
					logarithmic={true}
					className="parametric-q-control"
				/>
			</div>

			{/* Middle column: Gain and Frequency sliders */}
			<div className="parametric-band-sliders">
				{/* Gain slider */}
				<div className="parametric-slider-row">
					<label
						htmlFor={`parametric-gain-${bandKey}`}
						className="parametric-slider-label"
					>
						{bandName} Gain
					</label>
					<div className="parametric-slider-container">
						<input
							id={`parametric-gain-${bandKey}`}
							type="range"
							min={-12}
							max={12}
							step={0.5}
							value={bandConfig.gain}
							onChange={(e) =>
								onUpdate(bandKey, { gain: parseFloat(e.target.value) })
							}
							onDoubleClick={() => onUpdate(bandKey, { gain: 0 })}
							className="parametric-horizontal-slider"
						/>
						<span className="parametric-slider-value">
							{formatGain(bandConfig.gain)}
						</span>
					</div>
				</div>

				{/* Frequency slider */}
				<div className="parametric-slider-row">
					<label
						htmlFor={`parametric-freq-${bandKey}`}
						className="parametric-slider-label"
					>
						Freq
					</label>
					<div className="parametric-slider-container">
						<input
							id={`parametric-freq-${bandKey}`}
							type="range"
							min={0}
							max={1}
							step={0.001}
							value={freqToLinear(bandConfig.frequency)}
							onChange={(e) =>
								onUpdate(bandKey, {
									frequency: Math.round(
										linearToFreq(parseFloat(e.target.value)),
									),
								})
							}
							onDoubleClick={() => {
								// Reset to default frequency based on band
								const defaults = {
									lowBand: 100,
									midBand: 1000,
									highBand: 8000,
								};
								onUpdate(bandKey, { frequency: defaults[bandKey] });
							}}
							className="parametric-horizontal-slider"
						/>
						<span className="parametric-slider-value">
							{formatFrequency(bandConfig.frequency)}
						</span>
					</div>
				</div>
			</div>

			{/* Right column: Reserved for future effect */}
			<div className="parametric-band-effect">
				<div className="parametric-effect-placeholder">...</div>
			</div>
		</div>
	);
}

export function ParametricEqPanel({
	config,
	onUpdate,
	onSetEnabled,
	onReset,
}: ParametricEqPanelProps) {
	return (
		<div className="parametric-eq-section">
			<div className="parametric-eq-header">
				<h4>PARAMETRIC EQ</h4>
				<div className="effect-controls">
					<label className="effect-toggle">
						<input
							type="checkbox"
							checked={config.enabled}
							onChange={(e) => onSetEnabled(e.target.checked)}
						/>
						<span>ON</span>
					</label>
					<button
						type="button"
						onClick={onReset}
						className="reset-gain"
						title="Reset Parametric EQ"
					>
						↺
					</button>
				</div>
			</div>
			<div className="parametric-bands">
				<ParametricBand
					bandName="Low"
					bandConfig={config.lowBand}
					bandKey="lowBand"
					freqMin={20}
					freqMax={500}
					onUpdate={onUpdate}
				/>
				<ParametricBand
					bandName="Mid"
					bandConfig={config.midBand}
					bandKey="midBand"
					freqMin={200}
					freqMax={5000}
					onUpdate={onUpdate}
				/>
				<ParametricBand
					bandName="High"
					bandConfig={config.highBand}
					bandKey="highBand"
					freqMin={1000}
					freqMax={20000}
					onUpdate={onUpdate}
				/>
			</div>
		</div>
	);
}
