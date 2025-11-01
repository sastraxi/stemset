class MultiBandStereoExpander extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: "lowMidCrossover",
				defaultValue: 300,
				minValue: 50,
				maxValue: 2000,
			},
			{
				name: "midHighCrossover",
				defaultValue: 3000,
				minValue: 800,
				maxValue: 12000,
			},
			{ name: "expLow", defaultValue: 1, minValue: 0.5, maxValue: 3 },
			{ name: "compLow", defaultValue: 0.2, minValue: 0, maxValue: 1 },
			{ name: "expMid", defaultValue: 1.2, minValue: 0.5, maxValue: 3 },
			{ name: "compMid", defaultValue: 0.3, minValue: 0, maxValue: 1 },
			{ name: "expHigh", defaultValue: 1.6, minValue: 0.5, maxValue: 3 },
			{ name: "compHigh", defaultValue: 0.1, minValue: 0, maxValue: 1 },
			{ name: "rot", defaultValue: 0, minValue: -90, maxValue: 90 }, // Field rotation, optional
			{ name: "reverbBlend", defaultValue: 0.3, minValue: 0, maxValue: 1 }, // For wet/dry above width=1
		];
	}

	constructor() {
		super();
		this.env = [
			[0, 0],
			[0, 0],
			[0, 0],
		];
		this.lpState = [0, 0];
		this.hpState = [0, 0];
		this.reverbBuffer = null; // Will be sent from main thread!
		this.reverbPtr = 0;
		this.port.onmessage = (evt) => {
			if (evt.data.reverbBuffer) {
				this.reverbBuffer = evt.data.reverbBuffer;
				this.reverbLen = this.reverbBuffer.length;
			}
		};
	}

	clamp(x, min, max) {
		return Math.max(min, Math.min(x, max));
	}

	lowpass(x, cutoff, sr, state) {
		const RC = 1 / (2 * Math.PI * cutoff);
		const a = 1 / (1 + (RC * sr) / 128);
		const y = a * x + (1 - a) * state;
		return y;
	}

	highpass(x, cutoff, sr, state) {
		const lp = this.lowpass(x, cutoff, sr, state);
		return { y: x - lp, newState: lp };
	}

	compress(x, envState, amt) {
		const attack = 0.01,
			release = 0.2;
		const absx = Math.abs(x);
		let coef =
			absx > envState
				? Math.exp(-1 / (attack * sampleRate))
				: Math.exp(-1 / (release * sampleRate));
		let newEnv = coef * envState + (1 - coef) * absx;
		const threshold = 0.3;
		let gain = 1,
			knee = 0.2;
		if (newEnv > threshold) {
			let over = (newEnv - threshold) / knee;
			gain = 1 - amt * (1 - Math.exp(-over * 2));
		}
		return { out: x * gain, env: newEnv };
	}

	// Simple convolutional reverb for one sample (naive, small IR only!)
	convolveSample(input, ptr, reverbBuffer) {
		let out = 0;
		for (let i = 0; i < reverbBuffer.length; ++i) {
			// Simple circular buffer logic
			let idx = (ptr - i + reverbBuffer.length) % reverbBuffer.length;
			out += input[idx] * reverbBuffer[i];
		}
		return out;
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0],
			output = outputs[0];
		if (!input || input.length < 2) return true;
		const [inL, inR] = input;
		const [outL, outR] = output;
		const n = outL.length,
			sr = sampleRate;
		const lowMid = parameters.lowMidCrossover[0],
			midHigh = parameters.midHighCrossover[0];
		const exp = [
			parameters.expLow[0],
			parameters.expMid[0],
			parameters.expHigh[0],
		];
		const comp = [
			parameters.compLow[0],
			parameters.compMid[0],
			parameters.compHigh[0],
		];
		const rot = (parameters.rot ? parameters.rot[0] : 0) * 0.017453292;
		const reverbBlend = parameters.reverbBlend
			? parameters.reverbBlend[0]
			: 0.3;

		// Delay lines for basic per-channel convolution (for reverb)
		if (!this.inLhist) this.inLhist = new Float32Array(512);
		if (!this.inRhist) this.inRhist = new Float32Array(512);
		let ptr = this.reverbPtr;

		const band = [
			[new Float32Array(n), new Float32Array(n)],
			[new Float32Array(n), new Float32Array(n)],
			[new Float32Array(n), new Float32Array(n)],
		];

		for (let i = 0; i < n; ++i) {
			let L = inL[i],
				R = inR[i];

			// Field rotation (optional, REAPER-inspired)
			let angle = Math.atan2(L, R) - rot;
			let radius = Math.sqrt(L * L + R * R);
			L = Math.sin(angle) * radius;
			R = Math.cos(angle) * radius;

			// Band split
			band[0][0][i] = this.lowpass(L, lowMid, sr, this.lpState[0]);
			this.lpState[0] = band[0][0][i];
			band[0][1][i] = this.lowpass(R, lowMid, sr, this.lpState[1]);
			this.lpState[1] = band[0][1][i];

			let hp = this.highpass(L, midHigh, sr, this.hpState[0]);
			band[2][0][i] = hp.y;
			this.hpState[0] = hp.newState;
			hp = this.highpass(R, midHigh, sr, this.hpState[1]);
			band[2][1][i] = hp.y;
			this.hpState[1] = hp.newState;

			band[1][0][i] = L - band[0][0][i] - band[2][0][i];
			band[1][1][i] = R - band[0][1][i] - band[2][1][i];

			// Save for reverb convolution buffer
			this.inLhist[ptr] = L;
			this.inRhist[ptr] = R;
			ptr = (ptr + 1) % this.inLhist.length;
		}
		this.reverbPtr = ptr;

		// Process each band
		for (let b = 0; b < 3; ++b) {
			for (let i = 0; i < n; ++i) {
				// MS encode
				let M = 0.5 * (band[b][0][i] + band[b][1][i]);
				let S = 0.5 * (band[b][0][i] - band[b][1][i]);

				let width = exp[b];
				let widening_coeff = width > 1 ? 1 + 0.5 * (width - 1) : width;

				let reverbWet = 0;
				if (width > 1 && this.reverbBuffer) {
					// MS Decode to L/R for reverb
					let dryL = M + S,
						dryR = M - S;
					let idx =
						(this.reverbPtr + i - 1 + this.inLhist.length) %
						this.inLhist.length;
					let rL = this.convolveSample(this.inLhist, idx, this.reverbBuffer);
					let rR = this.convolveSample(this.inRhist, idx, this.reverbBuffer);
					// Reverb blend set higher with width
					let blend = (reverbBlend * (width - 1)) / 2;
					dryL = (1 - blend) * dryL + blend * rL;
					dryR = (1 - blend) * dryR + blend * rR;
					// MS re-encode after reverb blend
					M = 0.5 * (dryL + dryR);
					S = 0.5 * (dryL - dryR);
				}

				// Stereo expansion
				S *= this.clamp(widening_coeff, 0.5, 2);

				// MS decode to L/R
				let l = M + S,
					r = M - S;

				// Compression is only meaningful if width <= 1
				if (width <= 1) {
					let c0 = this.compress(l, this.env[b][0], comp[b]);
					l = l * 0.7 + c0.out * 0.3; // Parallel "NY" blend, tweak ratio for taste
					this.env[b][0] = c0.env;
					let c1 = this.compress(r, this.env[b][1], comp[b]);
					r = r * 0.7 + c1.out * 0.3;
					this.env[b][1] = c1.env;
				}

				outL[i] = (outL[i] || 0) + l;
				outR[i] = (outR[i] || 0) + r;
			}
		}

		for (let i = 0; i < n; ++i) {
			outL[i] = this.clamp(outL[i], -1, 1);
			outR[i] = this.clamp(outR[i], -1, 1);
		}
		return true;
	}
}

registerProcessor("multiband-stereo-expander", MultiBandStereoExpander);
