import type { ReverbSettings } from '../../hooks/effects/useReverbEffect';

export interface ReverbPanelProps {
  settings: ReverbSettings;
  onUpdate: (changes: Partial<ReverbSettings>) => void;
  onReset: () => void;
}

export function ReverbPanel({ settings, onUpdate, onReset }: ReverbPanelProps) {
  return (
    <div className="limiter-section">
      <div className="limiter-header">
        <h4>Reverb</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
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
          <label>Mix {(settings.mix * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.mix}
            onChange={(e) => onUpdate({ mix: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Decay {settings.decay.toFixed(2)}s</label>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.05}
            value={settings.decay}
            onChange={(e) => onUpdate({ decay: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Saturation {settings.satAmount.toFixed(1)}</label>
          <input
            type="range"
            min={0.1}
            max={3.0}
            step={0.1}
            value={settings.satAmount}
            onChange={(e) => onUpdate({ satAmount: parseFloat(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
