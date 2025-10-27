import type { StereoExpanderConfig } from '../../hooks/effects/useStereoExpanderEffect';

interface BandColumnProps {
  title: string;
  widthValue: number;
  compValue: number;
  onWidthChange: (value: number) => void;
  onCompChange: (value: number) => void;
}

interface CrossoverColumnProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function BandColumn({ title, widthValue, compValue, onWidthChange, onCompChange }: BandColumnProps) {
  return (
    <div className="stereo-band-column">
      <div className="limiter-ceiling">
        <label>Width {widthValue.toFixed(1)}x</label>
        <input
          type="range"
          min={0.5}
          max={2.0}
          step={0.1}
          value={widthValue}
          onChange={(e) => onWidthChange(parseFloat(e.target.value))}
        />
      </div>
      <div className="limiter-ceiling">
        <label>Comp {(compValue * 100).toFixed(0)}%</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={compValue}
          onChange={(e) => onCompChange(parseFloat(e.target.value))}
        />
      </div>
      <div className="band-header"><span>{title}</span></div>
    </div>
  );
}

function CrossoverColumn({ label, value, unit, min, max, step, onChange }: CrossoverColumnProps) {
  const displayValue = unit === 'kHz' ? (value / 1000).toFixed(1) : value.toString();

  return (
    <div className="crossover-column">
      <div className="crossover-vertical">
        <input
          type="range"
          className="crossover-slider-vertical"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <label className="crossover-label">{label}<br />{displayValue}{unit}</label>
      </div>
    </div>
  );
}

export interface StereoExpanderPanelProps {
  config: StereoExpanderConfig;
  onUpdate: (changes: Partial<StereoExpanderConfig>) => void;
  onReset: () => void;
}

export function StereoExpanderPanel({ config, onUpdate, onReset }: StereoExpanderPanelProps) {
  return (
    <div className="stereo-expander-section">
      <div className="limiter-header">
        <h4>Stereo Expander</h4>
        <div className="effect-controls">
          <label className="effect-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
              disabled
            />
            <span>On</span>
          </label>
          <button onClick={onReset} className="reset-gain" title="Reset Stereo Expander">
            ↺
          </button>
        </div>
      </div>

      <div className="stereo-expander-grid">
        <BandColumn
          title="Low"
          widthValue={config.expLow}
          compValue={config.compLow}
          onWidthChange={(value) => onUpdate({ expLow: value })}
          onCompChange={(value) => onUpdate({ compLow: value })}
        />

        <CrossoverColumn
          label="L/M"
          value={config.lowMidCrossover}
          unit="Hz"
          min={50}
          max={2000}
          step={10}
          onChange={(value) => onUpdate({ lowMidCrossover: value })}
        />

        <BandColumn
          title="Mid"
          widthValue={config.expMid}
          compValue={config.compMid}
          onWidthChange={(value) => onUpdate({ expMid: value })}
          onCompChange={(value) => onUpdate({ compMid: value })}
        />

        <CrossoverColumn
          label="M/H"
          value={config.midHighCrossover}
          unit="kHz"
          min={800}
          max={12000}
          step={100}
          onChange={(value) => onUpdate({ midHighCrossover: value })}
        />

        <BandColumn
          title="High"
          widthValue={config.expHigh}
          compValue={config.compHigh}
          onWidthChange={(value) => onUpdate({ expHigh: value })}
          onCompChange={(value) => onUpdate({ compHigh: value })}
        />
      </div>
    </div>
  );
}
