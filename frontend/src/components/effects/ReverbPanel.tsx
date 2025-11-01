import type { ImpulseName, ReverbConfig } from '@/types';
import { IMPULSES } from '@/types';

export interface ReverbPanelProps {
  config: ReverbConfig;
  onUpdate: (changes: Partial<ReverbConfig>) => void;
  onReset: () => void;
}

export function ReverbPanel({ config, onUpdate, onReset }: ReverbPanelProps) {
  return (
    <div className="reverb-section">
      <div className="reverb-header">
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
      <div className="reverb-controls">
        <div className="reverb-impulse">
          <label>Impulse Response</label>
          <select
            value={config.impulse}
            onChange={(e) => onUpdate({ impulse: e.target.value as ImpulseName })}
            className="impulse-select"
          >
            {Object.entries(IMPULSES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="reverb-mix">
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
      </div>
    </div>
  );
}
