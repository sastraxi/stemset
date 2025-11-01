import type { EqBand, EqConfig } from "@/types";

export interface EqPanelProps {
	config: EqConfig;
	onUpdateBand: (
		id: string,
		changes: Partial<Pick<EqBand, "gain" | "frequency" | "q" | "type">>,
	) => void;
	onSetEnabled: (enabled: boolean) => void;
	onReset: () => void;
}

export function EqPanel({
	config,
	onUpdateBand,
	onSetEnabled,
	onReset,
}: EqPanelProps) {
	return (
		<div className="eq-section">
			<div className="eq-header">
				<h4>Graphic EQ</h4>
				<div className="effect-controls">
					<label className="effect-toggle">
						<input
							type="checkbox"
							checked={config.enabled}
							onChange={(e) => onSetEnabled(e.target.checked)}
						/>
						<span>On</span>
					</label>
					<button
						type="button"
						onClick={onReset}
						className="reset-gain"
						title="Reset EQ"
					>
						↺
					</button>
				</div>
			</div>
			<div className="eq-bands vertical">
				{config.bands.map((b) => (
					<div key={b.id} className="eq-band-vertical">
						<label htmlFor={`eq-band-${b.id}`} className="eq-band-label">
							{b.id}
							<br />
							<small>{b.frequency}Hz</small>
						</label>
						<input
							id={`eq-band-${b.id}`}
							type="range"
							min={-12}
							max={12}
							step={0.5}
							value={b.gain}
							onChange={(e) =>
								onUpdateBand(b.id, { gain: parseFloat(e.target.value) })
							}
							className="eq-slider-vertical"
						/>
						<span className="eq-band-value">{b.gain.toFixed(1)}dB</span>
					</div>
				))}
			</div>
		</div>
	);
}
