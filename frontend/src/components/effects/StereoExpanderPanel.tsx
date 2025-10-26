import type { StereoExpanderSettings } from '../../hooks/effects/useStereoExpanderEffect';

export interface StereoExpanderPanelProps {
  settings: StereoExpanderSettings;
  onUpdate: (changes: Partial<StereoExpanderSettings>) => void;
  onReset: () => void;
}

export function StereoExpanderPanel({ settings, onUpdate, onReset }: StereoExpanderPanelProps) {
  return (
    <div className="limiter-section">
      <div className="limiter-header">
        <h4>Stereo Expander</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            <span>On</span>
          </label>
          <button onClick={onReset} className="reset-gain" title="Reset Stereo Expander">
            ↺
          </button>
        </div>
      </div>
      <div className="limiter-controls">
        <div className="limiter-ceiling">
          <label>Low/Mid Crossover {settings.lowMidCrossover}Hz</label>
          <input
            type="range"
            min={50}
            max={2000}
            step={10}
            value={settings.lowMidCrossover}
            onChange={(e) => onUpdate({ lowMidCrossover: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid/High Crossover {settings.midHighCrossover}Hz</label>
          <input
            type="range"
            min={800}
            max={12000}
            step={100}
            value={settings.midHighCrossover}
            onChange={(e) => onUpdate({ midHighCrossover: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Low Width {settings.expLow.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={settings.expLow}
            onChange={(e) => onUpdate({ expLow: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Low Comp {(settings.compLow * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.compLow}
            onChange={(e) => onUpdate({ compLow: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid Width {settings.expMid.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={settings.expMid}
            onChange={(e) => onUpdate({ expMid: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid Comp {(settings.compMid * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.compMid}
            onChange={(e) => onUpdate({ compMid: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>High Width {settings.expHigh.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={settings.expHigh}
            onChange={(e) => onUpdate({ expHigh: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>High Comp {(settings.compHigh * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.compHigh}
            onChange={(e) => onUpdate({ compHigh: parseFloat(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
