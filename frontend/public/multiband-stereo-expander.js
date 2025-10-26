class MultiBandStereoExpander extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        // Per-band stereo width (0.5 = more mono, 2 = super wide, 1.0 = unchanged)
        // Per-band comp amt (0 = no comp, higher = squishier)
        // 2 crossovers (in Hz)
        return [
            { name: 'lowMidCrossover', defaultValue: 300, minValue: 50, maxValue: 2000 },
            { name: 'midHighCrossover', defaultValue: 3000, minValue: 800, maxValue: 12000 },
            // Stereo width and comp per band: [Low, Mid, High]
            { name: 'expLow', defaultValue: 1, minValue: 0.5, maxValue: 2 },
            { name: 'compLow', defaultValue: 0.2, minValue: 0, maxValue: 1 },
            { name: 'expMid', defaultValue: 1.2, minValue: 0.5, maxValue: 2 },
            { name: 'compMid', defaultValue: 0.3, minValue: 0, maxValue: 1 },
            { name: 'expHigh', defaultValue: 1.6, minValue: 0.5, maxValue: 2 },
            { name: 'compHigh', defaultValue: 0.1, minValue: 0, maxValue: 1 },
        ];
    }

    constructor() {
        super();
        // RMS envelope states per band/channel
        this.env = [
            [0, 0], [0, 0], [0, 0]
        ]; // band x channel (L/R)
        // Filter state storage
        this.lpState = [0, 0];
        this.hpState = [0, 0];
        this.mpState = [0, 0];
    }

    // 1st-order Linkwitz-Riley lowpass
    lowpass(x, cutoff, sr, state) {
        const RC = 1 / (2 * Math.PI * cutoff);
        const a = 1 / (1 + RC * sr / 128);
        const y = a * x + (1 - a) * state;
        return y;
    }
    // Highpass = Input - Lowpass
    highpass(x, cutoff, sr, state) {
        const lp = this.lowpass(x, cutoff, sr, state);
        const hp = x - lp;
        return { y: hp, newState: lp };
    }

    // Simple RMS comp per band/channel
    compress(x, envState, amt) {
        // envState is shared per band/ch for coherence
        const attack = 0.01, release = 0.2; // As in 70s gear: gentle, slow(-ish)
        const absx = Math.abs(x);
        const coef = absx > envState ? Math.exp(-1 / (attack * sampleRate)) : Math.exp(-1 / (release * sampleRate));
        const newEnv = absx + coef * (envState - absx);
        const threshold = 0.3; // Soft-knee start
        let gain = 1, knee = 0.2;
        if (newEnv > threshold) {
            // Soft-knee: squishy above threshold, smooth
            let over = (newEnv - threshold) / knee;
            gain = 1 - amt * (1 - Math.exp(-over * 2));
        }
        return { out: x * gain, env: newEnv };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0], output = outputs[0];
        if (!input || input.length < 2) return true;
        const [inL, inR] = input;
        const [outL, outR] = output;
        const n = outL.length, sr = sampleRate;
        // Get time-invariant parameters for block
        const lowMid = parameters.lowMidCrossover[0], midHigh = parameters.midHighCrossover[0];
        const exp = [
            parameters.expLow[0], parameters.expMid[0], parameters.expHigh[0]
        ];
        const comp = [
            parameters.compLow[0], parameters.compMid[0], parameters.compHigh[0]
        ];
        // Buffers for L/M/H bands per channel
        const band = [[new Float32Array(n), new Float32Array(n)], [new Float32Array(n), new Float32Array(n)], [new Float32Array(n), new Float32Array(n)]];
        // FILTER SPLIT: Cascading stateful first-order (for "wooliness")
        for (let i = 0; i < n; ++i) {
            // Low = lowpass at lowMid
            band[0][0][i] = this.lowpass(inL[i], lowMid, sr, this.lpState[0]);
            this.lpState[0] = band[0][0][i];
            band[0][1][i] = this.lowpass(inR[i], lowMid, sr, this.lpState[1]);
            this.lpState[1] = band[0][1][i];
            // High = highpass at midHigh
            let hp = this.highpass(inL[i], midHigh, sr, this.hpState[0]);
            band[2][0][i] = hp.y;
            this.hpState[0] = hp.newState;
            hp = this.highpass(inR[i], midHigh, sr, this.hpState[1]);
            band[2][1][i] = hp.y;
            this.hpState[1] = hp.newState;
            // Mid = what's left (input - low - high)
            band[1][0][i] = inL[i] - band[0][0][i] - band[2][0][i];
            band[1][1][i] = inR[i] - band[0][1][i] - band[2][1][i];
        }
        // Per-band: MS stereo expansion + comp + sum bands
        for (let b = 0; b < 3; ++b) {
            for (let i = 0; i < n; ++i) {
                // MS encode (Mid, Side)
                let M = 0.5 * (band[b][0][i] + band[b][1][i]);
                let S = 0.5 * (band[b][0][i] - band[b][1][i]);
                S *= exp[b]; // stereo expansion: scale S
                // MS decode
                let l = M + S;
                let r = M - S;
                // Compress BOTH channels for phase coherence
                let c0 = this.compress(l, this.env[b][0], comp[b]);
                l = c0.out; this.env[b][0] = c0.env;
                let c1 = this.compress(r, this.env[b][1], comp[b]);
                r = c1.out; this.env[b][1] = c1.env;
                outL[i] = (outL[i] || 0) + l;
                outR[i] = (outR[i] || 0) + r;
            }
        }
        // Optional: normalize to avoid overloads
        for (let i = 0; i < n; ++i) {
            outL[i] = Math.max(-1, Math.min(1, outL[i]));
            outR[i] = Math.max(-1, Math.min(1, outR[i]));
        }
        return true;
    }
}
registerProcessor("multiband-stereo-expander", MultiBandStereoExpander);
