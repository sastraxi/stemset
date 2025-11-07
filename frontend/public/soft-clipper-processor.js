/**
 * Soft Clipper Audio Worklet Processor
 *
 * Provides musical saturation and soft-clipping to prevent harsh digital clipping.
 * Uses various saturation curves (tanh, atan, cubic) for smooth peak limiting.
 *
 * Parameters:
 * - enabled: 0-1 (bypass when 0)
 * - threshold: 0-1 (input level where saturation starts, default 0.8)
 * - drive: 1-10 (input gain multiplier, default 1.0)
 * - curve: 0-2 (0=tanh, 1=atan, 2=cubic, default 0)
 * - mix: 0-1 (dry/wet blend, default 1.0)
 */

class SoftClipperProcessor extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{
				name: "enabled",
				defaultValue: 1,
				minValue: 0,
				maxValue: 1,
				automationRate: "k-rate",
			},
			{
				name: "threshold",
				defaultValue: 0.8,
				minValue: 0.1,
				maxValue: 1.0,
				automationRate: "k-rate",
			},
			{
				name: "drive",
				defaultValue: 1.0,
				minValue: 1.0,
				maxValue: 10.0,
				automationRate: "k-rate",
			},
			{
				name: "curve",
				defaultValue: 0,
				minValue: 0,
				maxValue: 2,
				automationRate: "k-rate",
			},
			{
				name: "mix",
				defaultValue: 1.0,
				minValue: 0.0,
				maxValue: 1.0,
				automationRate: "k-rate",
			},
		];
	}

	constructor() {
		super();
	}

	/**
	 * Hyperbolic tangent soft clipping
	 * Smooth, natural saturation similar to analog tape
	 */
	tanhClipper(sample, threshold, drive) {
		const driven = sample * drive;
		const normalizedThreshold = threshold;

		// Apply tanh saturation scaled by threshold
		const saturated = Math.tanh(driven / normalizedThreshold) * normalizedThreshold;

		return saturated;
	}

	/**
	 * Arctangent soft clipping
	 * Gentler saturation curve, more transparent
	 */
	atanClipper(sample, threshold, drive) {
		const driven = sample * drive;
		const normalizedThreshold = threshold;

		// Arctangent saturation with scaling
		const saturated = (Math.atan(driven / normalizedThreshold) / (Math.PI / 2)) * normalizedThreshold;

		return saturated;
	}

	/**
	 * Cubic soft clipping
	 * Classic analog-style saturation with pleasant harmonics
	 */
	cubicClipper(sample, threshold, drive) {
		const driven = sample * drive;
		const normalizedThreshold = threshold;
		const abs = Math.abs(driven);

		if (abs < normalizedThreshold) {
			return driven;
		}

		// Cubic soft knee above threshold
		const excess = abs - normalizedThreshold;
		const maxExcess = 1.0 - normalizedThreshold;

		if (excess >= maxExcess) {
			// Hard limit at 1.0
			return driven > 0 ? 1.0 : -1.0;
		}

		// Cubic curve in the knee region
		const t = excess / maxExcess;
		const knee = maxExcess * (1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t));
		const output = normalizedThreshold + knee;

		return driven > 0 ? output : -output;
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		const output = outputs[0];

		if (!input || !output || input.length === 0) {
			return true;
		}

		const enabled = parameters.enabled[0];
		const threshold = parameters.threshold[0];
		const drive = parameters.drive[0];
		const curve = Math.round(parameters.curve[0]);
		const mix = parameters.mix[0];

		// Bypass if disabled
		if (enabled < 0.5) {
			for (let channel = 0; channel < input.length; channel++) {
				output[channel].set(input[channel]);
			}
			return true;
		}

		// Select clipper function based on curve parameter
		let clipperFunc;
		switch (curve) {
			case 1:
				clipperFunc = this.atanClipper.bind(this);
				break;
			case 2:
				clipperFunc = this.cubicClipper.bind(this);
				break;
			case 0:
			default:
				clipperFunc = this.tanhClipper.bind(this);
				break;
		}

		// Process each channel
		for (let channel = 0; channel < input.length; channel++) {
			const inputChannel = input[channel];
			const outputChannel = output[channel];

			for (let i = 0; i < inputChannel.length; i++) {
				const dry = inputChannel[i];
				const wet = clipperFunc(dry, threshold, drive);

				// Mix dry and wet signals
				outputChannel[i] = dry * (1.0 - mix) + wet * mix;
			}
		}

		return true;
	}
}

registerProcessor("soft-clipper-processor", SoftClipperProcessor);
