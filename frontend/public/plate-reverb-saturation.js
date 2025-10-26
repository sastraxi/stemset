class PlateReverbSaturator extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'mix', defaultValue: 0.3, minValue: 0, maxValue: 1 },
            { name: 'decay', defaultValue: 0.6, minValue: 0.1, maxValue: 2 },
            { name: 'satAmount', defaultValue: 1.5, minValue: 0.1, maxValue: 3 }
        ];
    }

    constructor(options) {
        super();
        const sr = sampleRate;
        // Set up delays typical of plate early/late reflections
        this.delayLines = [
            new Float32Array(Math.floor(0.017 * sr)), // Early
            new Float32Array(Math.floor(0.021 * sr)), // Early
            new Float32Array(Math.floor(0.031 * sr)), // Late
            new Float32Array(Math.floor(0.043 * sr))  // Late
        ];
        this.delayIndices = [0, 0, 0, 0];
        // Allpass diffusion filters, with internal states
        this.allpassBuffers = [
            new Float32Array(Math.floor(0.0077 * sr)),
            new Float32Array(Math.floor(0.013 * sr)),
            new Float32Array(Math.floor(0.011 * sr))
        ];
        this.allpassIndices = [0, 0, 0];
        this.allpassGains = [0.67, 0.5, 0.7];
    }

    // Waveshaping for harmonic generation
    saturate(x, amt) {
        return Math.tanh(x * amt) / Math.tanh(amt);
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0) return true;
        const c = Math.min(input.length, output.length);
        const samples = output[0].length;

        // Parameters
        const mix = parameters.mix.length > 1 ? parameters.mix[0] : parameters.mix[0];
        const decay = parameters.decay.length > 1 ? parameters.decay[0] : parameters.decay[0];
        const satAmount = parameters.satAmount.length > 1 ? parameters.satAmount[0] : parameters.satAmount[0];

        for (let i = 0; i < samples; ++i) {
            for (let ch = 0; ch < c; ++ch) {
                let dry = input[ch][i];
                let wet = dry;

                // Early reflections: parallel delays feed summed into allpass network
                let earlySum = 0;
                for (let d = 0; d < this.delayLines.length; ++d) {
                    let idx = this.delayIndices[d];
                    earlySum += this.delayLines[d][idx] * 0.25; // average
                    this.delayLines[d][idx] = dry;
                    this.delayIndices[d] = (idx + 1) % this.delayLines[d].length;
                }
                wet = earlySum;

                // Pass through series of saturated allpass filters
                for (let f = 0; f < this.allpassBuffers.length; ++f) {
                    let buf = this.allpassBuffers[f], apGain = this.allpassGains[f], idx = this.allpassIndices[f];
                    // Allpass filter: classic
                    let x = wet + buf[idx] * apGain;
                    // Saturate feedback
                    x = this.saturate(x, satAmount); // nonlinear harmonics!
                    let y = buf[idx] - apGain * x;
                    wet = y;
                    buf[idx] = x * decay; // decay inside feedback
                    this.allpassIndices[f] = (idx + 1) % buf.length;
                }

                // Mix dry/wet
                output[ch][i] = (1 - mix) * dry + mix * wet;
            }
        }
        return true;
    }
}
registerProcessor("plate-reverb-saturator", PlateReverbSaturator);
