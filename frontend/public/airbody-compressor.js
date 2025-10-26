/**
 * AirBodyCompressor AudioWorklet Processor
 * 
 * A musical compressor/limiter that provides both "body" (lower-mids) and "air" (high frequencies)
 * characteristics through multi-band processing with gentle harmonic saturation.
 */
class AirBodyCompressor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'threshold', defaultValue: -6, minValue: -40, maxValue: 0 },
            { name: 'attack', defaultValue: 0.005, minValue: 0.001, maxValue: 0.1 },
            { name: 'release', defaultValue: 0.1, minValue: 0.01, maxValue: 1.0 },
            { name: 'bodyBlend', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'airBlend', defaultValue: 0.5, minValue: 0, maxValue: 1 }
        ];
    }

    constructor() {
        super();

        // Envelope followers for bands
        this.bodyEnv = 0;
        this.airEnv = 0;

        // Simple filters coefficients (assumes ~44kHz)
        this.lowMidAlpha = 0.15;   // Low-mid smoothing
        this.highAlpha = 0.75;     // High smoothing

        // Filter history per channel (support up to 8 channels)
        this.bodyHist = new Array(8).fill(0);
        this.airHist = new Array(8).fill(0);

        // Gain reduction tracking for metering
        this.currentReduction = 0;
        this.reductionSmoothingAlpha = 0.1;

        // Port for sending gain reduction data
        this.port.onmessage = (_event) => {
            // Handle messages from main thread if needed
        };
    }

    dBToLinear(db) {
        return Math.pow(10, db / 20);
    }

    envelopeCoef(t) {
        return Math.exp(-1 / (t * sampleRate));
    }

    softSaturate(x, amt) {
        // Gentle tanh saturation that adds harmonics while limiting peaks
        return Math.tanh(x * amt) / Math.tanh(amt);
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !output || input.length === 0 || output.length === 0) return true;

        const channelCount = Math.min(input.length, output.length);
        const samples = output[0].length;

        // Get parameters for this block (can be per-sample or per-block)
        const getParam = (param, index) => {
            return param.length > 1 ? param[index] : param[0];
        };

        let maxReduction = 0;

        for (let i = 0; i < samples; ++i) {
            const threshold = this.dBToLinear(getParam(parameters.threshold, i));
            const attack = getParam(parameters.attack, i);
            const release = getParam(parameters.release, i);
            const bodyBlend = getParam(parameters.bodyBlend, i);
            const airBlend = getParam(parameters.airBlend, i);

            for (let ch = 0; ch < channelCount; ++ch) {
                // Get input sample
                const sample = input[ch][i];

                // -------- Low-Mid "Body" band --------
                // Simple first-order low shelf filter
                const body = (1 - this.lowMidAlpha) * sample + this.lowMidAlpha * this.bodyHist[ch];
                this.bodyHist[ch] = sample;

                // Envelope follower for body band
                const bodyPeak = Math.abs(body);
                const bodyCoef = bodyPeak > this.bodyEnv ? this.envelopeCoef(attack) : this.envelopeCoef(release);
                this.bodyEnv = bodyPeak + bodyCoef * (this.bodyEnv - bodyPeak);

                // Apply limiting with saturation to body band
                let bodyGain = 1.0;
                if (this.bodyEnv > threshold) {
                    bodyGain = threshold / this.bodyEnv;
                }
                const bodyOut = this.softSaturate(body * bodyGain, 2.5) * bodyBlend;

                // Track reduction for metering
                if (bodyGain < 1.0) {
                    const reductionDb = -20 * Math.log10(bodyGain);
                    maxReduction = Math.max(maxReduction, reductionDb);
                }

                // -------- High "Air" band --------
                // First-order high-pass filter
                const air = sample - (1 - this.highAlpha) * this.airHist[ch];
                this.airHist[ch] = sample;

                // Envelope follower for air band
                const airPeak = Math.abs(air);
                const airCoef = airPeak > this.airEnv ? this.envelopeCoef(attack) : this.envelopeCoef(release);
                this.airEnv = airPeak + airCoef * (this.airEnv - airPeak);

                // Apply limiting with saturation to air band
                let airGain = 1.0;
                if (this.airEnv > threshold) {
                    airGain = threshold / this.airEnv;
                }
                const airOut = this.softSaturate(air * airGain, 2.5) * airBlend;

                // Track reduction for metering
                if (airGain < 1.0) {
                    const reductionDb = -20 * Math.log10(airGain);
                    maxReduction = Math.max(maxReduction, reductionDb);
                }

                // -------- Remaining (Mid) band --------
                // Subtract processed bands to get mid (approximately)
                const mid = sample - (body + air);

                // Blend output bands
                output[ch][i] = bodyOut + airOut + mid * (1.0 - bodyBlend - airBlend);
            }
        }

        // Smooth gain reduction for metering and send to main thread
        this.currentReduction = this.currentReduction * (1 - this.reductionSmoothingAlpha) +
            maxReduction * this.reductionSmoothingAlpha;

        // Send reduction data every quantum (128 samples ~= 3ms at 44kHz)
        this.port.postMessage({
            type: 'gainReduction',
            value: this.currentReduction
        });

        return true;
    }
}

registerProcessor("airbody-compressor", AirBodyCompressor);