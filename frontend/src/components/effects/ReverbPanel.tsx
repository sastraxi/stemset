import type { ReverbConfig } from '../../hooks/effects/useReverbEffect';

export interface ReverbPanelProps {
  config: ReverbConfig;
  onUpdate: (changes: Partial<ReverbConfig>) => void;
  onReset: () => void;
}

export function ReverbPanel({ config, onUpdate, onReset }: ReverbPanelProps) {
  return (
    <div className="limiter-section">
      <div className="limiter-header">
        <h4>Reverb</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            <span>On</span>
          </label>
          <button onClick={onReset} className="reset-gain" title="Reset Reverb">
            ↺
          </button>
        </div>
      </div>
      <div className="limiter-controls">
        <div className="limiter-ceiling">
          <label>Mix {(config.mix * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={config.mix}
            onChange={(e) => onUpdate({ mix: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Decay {config.decay.toFixed(2)}s</label>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.05}
            value={config.decay}
            onChange={(e) => onUpdate({ decay: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Saturation {config.satAmount.toFixed(1)}</label>
          <input
            type="range"
            min={0.1}
            max={3.0}
            step={0.1}
            value={config.satAmount}
            onChange={(e) => onUpdate({ satAmount: parseFloat(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
