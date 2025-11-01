// file: limiter-processor.js
// Professional brick-wall limiter with smooth envelope following
// Based on best practices from Signalsmith Audio and mastering literature
class MasterLimiterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'threshold', defaultValue: -6, minValue: -48, maxValue: 0 },
            { name: 'attack', defaultValue: 0.005, minValue: 0.001, maxValue: 0.05 },
            { name: 'hold', defaultValue: 0.02, minValue: 0.001, maxValue: 0.1 },
            { name: 'release', defaultValue: 0.1, minValue: 0.01, maxValue: 1.0 },
            { name: 'makeupGain', defaultValue: 0, minValue: -24, maxValue: 24 }
        ];
    }

    constructor() {
        super();

        // Lookahead buffer (50ms max)
        this.bufferSize = Math.floor(sampleRate * 0.05);
        this.lookaheadBuffers = [];
        this.writeIndices = [];
        for (let i = 0; i < 8; i++) {
            this.lookaheadBuffers[i] = new Float32Array(this.bufferSize);
            this.writeIndices[i] = 0;
        }

        // Envelope state
        this.currentGain = 1.0;
        this.holdCounter = 0;

        // Gain reduction tracking for metering
        this.currentReduction = 0;
        this.reductionSmoothingAlpha = 0.1;

        // Port for sending gain reduction data
        this.port.onmessage = (_event) => {
            // Handle messages from main thread if needed
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input.length || !output.length) return true;

        const channelCount = Math.min(input.length, output.length);
        const frameCount = input[0].length;

        // Get parameters
        const thresholdDb = parameters.threshold.length > 1 ? parameters.threshold[0] : parameters.threshold;
        const threshold = Math.pow(10, thresholdDb / 20);
        const makeupGainDb = parameters.makeupGain[0] || 0;
        const makeup = Math.pow(10, makeupGainDb / 20);

        const attackTime = parameters.attack[0];
        const holdTime = parameters.hold[0];
        const releaseTime = parameters.release[0];

        // Convert times to samples
        const attackSamples = Math.max(1, Math.floor(attackTime * sampleRate));
        const holdSamples = Math.floor(holdTime * sampleRate);
        const releaseSamples = Math.max(1, Math.floor(releaseTime * sampleRate));

        // Calculate coefficients for exponential smoothing
        const attackCoef = Math.exp(-1 / attackSamples);
        const releaseCoef = Math.exp(-1 / releaseSamples);

        let maxReduction = 0;

        // Process each sample
        for (let i = 0; i < frameCount; i++) {
            // Find peak across all channels (at lookahead position)
            let peak = 0;
            for (let ch = 0; ch < channelCount; ch++) {
                const sample = input[ch][i];
                peak = Math.max(peak, Math.abs(sample));
            }

            // Calculate target gain (how much we need to reduce to stay under threshold)
            let targetGain = 1.0;
            if (peak > threshold) {
                targetGain = threshold / peak;
            }

            // Envelope follower with attack/hold/release
            if (targetGain < this.currentGain) {
                // Peak detected - attack phase (fast reduction)
                this.currentGain = targetGain + attackCoef * (this.currentGain - targetGain);
                this.holdCounter = holdSamples; // Reset hold counter
            } else if (this.holdCounter > 0) {
                // Hold phase - maintain current gain
                this.holdCounter--;
            } else {
                // Release phase (slow recovery)
                this.currentGain = targetGain + releaseCoef * (this.currentGain - targetGain);
            }

            // Track gain reduction for metering
            if (this.currentGain < 1.0) {
                const reductionDb = -20 * Math.log10(this.currentGain);
                maxReduction = Math.max(maxReduction, reductionDb);
            }

            // Apply gain to all channels with lookahead delay
            for (let ch = 0; ch < channelCount; ch++) {
                // Write current sample to delay buffer
                this.lookaheadBuffers[ch][this.writeIndices[ch]] = input[ch][i];

                // Read delayed sample (from attackSamples ago)
                const readIndex = (this.writeIndices[ch] - attackSamples + this.bufferSize) % this.bufferSize;
                const delayedSample = this.lookaheadBuffers[ch][readIndex];

                // Apply gain reduction and makeup gain
                output[ch][i] = delayedSample * this.currentGain * makeup;

                // Advance write index
                this.writeIndices[ch] = (this.writeIndices[ch] + 1) % this.bufferSize;
            }
        }

        // Smooth gain reduction for metering and send to main thread
        this.currentReduction = this.currentReduction * (1 - this.reductionSmoothingAlpha) +
            maxReduction * this.reductionSmoothingAlpha;

        // Send reduction data every quantum
        this.port.postMessage({
            type: 'gainReduction',
            value: this.currentReduction
        });

        return true;
    }
}

registerProcessor('master-limiter-processor', MasterLimiterProcessor);
