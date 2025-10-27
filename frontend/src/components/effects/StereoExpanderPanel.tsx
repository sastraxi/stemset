import type { StereoExpanderConfig } from '../../hooks/effects/useStereoExpanderEffect';

export interface StereoExpanderPanelProps {
  config: StereoExpanderConfig;
  onUpdate: (changes: Partial<StereoExpanderConfig>) => void;
  onReset: () => void;
}

export function StereoExpanderPanel({ config, onUpdate, onReset }: StereoExpanderPanelProps) {
  return (
    <div className="limiter-section">
      <div className="limiter-header">
        <h4>Stereo Expander</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
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
          <label>Low/Mid Crossover {config.lowMidCrossover}Hz</label>
          <input
            type="range"
            min={50}
            max={2000}
            step={10}
            value={config.lowMidCrossover}
            onChange={(e) => onUpdate({ lowMidCrossover: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid/High Crossover {config.midHighCrossover}Hz</label>
          <input
            type="range"
            min={800}
            max={12000}
            step={100}
            value={config.midHighCrossover}
            onChange={(e) => onUpdate({ midHighCrossover: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Low Width {config.expLow.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={config.expLow}
            onChange={(e) => onUpdate({ expLow: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Low Comp {(config.compLow * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.compLow}
            onChange={(e) => onUpdate({ compLow: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid Width {config.expMid.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={config.expMid}
            onChange={(e) => onUpdate({ expMid: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Mid Comp {(config.compMid * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.compMid}
            onChange={(e) => onUpdate({ compMid: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>High Width {config.expHigh.toFixed(1)}x</label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={config.expHigh}
            onChange={(e) => onUpdate({ expHigh: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>High Comp {(config.compHigh * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.compHigh}
            onChange={(e) => onUpdate({ compHigh: parseFloat(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
