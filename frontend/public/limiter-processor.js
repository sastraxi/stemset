// file: limiter-processor.js
class MasterLimiterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'threshold', defaultValue: -6, minValue: -48, maxValue: 0 },
            { name: 'lookahead', defaultValue: 0.005, minValue: 0, maxValue: 0.05 },
            { name: 'makeupGain', defaultValue: 0, minValue: -12, maxValue: 12 },
            { name: 'eqLow', defaultValue: 1.0, minValue: 0.0, maxValue: 3.0 },
            { name: 'eqHigh', defaultValue: 1.0, minValue: 0.0, maxValue: 3.0 }
        ];
    }

    constructor() {
        super();
        const sampleRate = sampleRate ?? 48000;
        this.bufferSize = Math.floor(sampleRate * 0.05);
        this.lookaheadBuffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
        this.readIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input.length || !output.length) return true;
        const chDataIn = input[0];
        const chDataOut = output[0];

        const thresholdDb = parameters.threshold.length > 1 ? parameters.threshold[0] : parameters.threshold;
        const threshold = Math.pow(10, thresholdDb / 20);
        const makeup = Math.pow(10, (parameters.makeupGain[0] || 0) / 20);
        const lookaheadTime = parameters.lookahead[0];
        const lookaheadSamples = Math.floor(lookaheadTime * sampleRate);

        // simple "EQ weighting" before limiter – lowpass/highpass scales
        const eqLow = parameters.eqLow[0];
        const eqHigh = parameters.eqHigh[0];

        for (let i = 0; i < chDataIn.length; i++) {
            // Write to delay buffer
            this.lookaheadBuffer[this.writeIndex] = chDataIn[i];
            this.writeIndex = (this.writeIndex + 1) % this.bufferSize;

            // Calculate envelope on current input sample
            // Basic EQ weighting: a rough tonal balance modifier
            const low = chDataIn[i] * eqLow;
            const high = chDataIn[i] * eqHigh;
            const weighted = 0.5 * (low + high);

            let gain = 1.0;
            const abs = Math.abs(weighted);
            if (abs > threshold) {
                gain = threshold / abs;
            }

            // Apply gain to delayed sample
            const delayedSample = this.lookaheadBuffer[(this.writeIndex - lookaheadSamples + this.bufferSize) % this.bufferSize] || 0;
            chDataOut[i] = delayedSample * gain * makeup;
        }

        return true;
    }
}

registerProcessor('master-limiter-processor', MasterLimiterProcessor);