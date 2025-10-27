import type { CompressorConfig } from '../../hooks/effects/useCompressorEffect';

export interface CompressorPanelProps {
  config: CompressorConfig;
  gainReduction: number;
  onUpdate: (changes: Partial<CompressorConfig>) => void;
  onReset: () => void;
}

export function CompressorPanel({ config, gainReduction, onUpdate, onReset }: CompressorPanelProps) {
  return (
    <div className="limiter-section">
      <div className="limiter-header">
        <h4>Compressor</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
            />
            <span>On</span>
          </label>
          <button onClick={onReset} className="reset-gain" title="Reset Compressor">
            ↺
          </button>
        </div>
      </div>
      <div className="limiter-controls">
        <div className="limiter-ceiling">
          <label>Threshold {config.threshold} dB</label>
          <input
            type="range"
            min={-40}
            max={0}
            step={1}
            value={config.threshold}
            onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Attack {Math.floor(config.attack * 1000)}ms</label>
          <input
            type="range"
            min={0.001}
            max={0.1}
            step={0.001}
            value={config.attack}
            onChange={(e) => onUpdate({ attack: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Release {Math.floor(config.release * 1000)}ms</label>
          <input
            type="range"
            min={0.01}
            max={1.0}
            step={0.01}
            value={config.release}
            onChange={(e) => onUpdate({ release: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Body {(config.bodyBlend * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={config.bodyBlend}
            onChange={(e) => onUpdate({ bodyBlend: parseFloat(e.target.value) })}
          />
        </div>
        <div className="limiter-ceiling">
          <label>Air {(config.airBlend * 100).toFixed(0)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={config.airBlend}
            onChange={(e) => onUpdate({ airBlend: parseFloat(e.target.value) })}
          />
        </div>
        <div className="flex-grow" />
        <div className="limiter-reduction">
          <label className="meter-label">Gain Reduction {gainReduction.toFixed(1)} dB</label>
          <div className="gr-meter" title={`${gainReduction.toFixed(1)} dB`}>
            {(() => {
              // Log-like visualization: map 0-25dB to 0-100% using (value/25)^(0.65)
              const norm = gainReduction <= 0 ? 0 : Math.pow(Math.min(gainReduction, 25) / 25, 0.65);
              const pct = norm * 100;
              return <div className="gr-fill" style={{ width: `${pct}%` }} />;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
