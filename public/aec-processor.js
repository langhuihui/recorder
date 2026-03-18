/**
 * AEC (Acoustic Echo Cancellation) AudioWorklet Processor
 *
 * Uses a Normalized Least Mean Squares (NLMS) adaptive filter to estimate
 * and subtract the acoustic echo of the background music that the microphone
 * picks up from the room, while preserving the human voice.
 *
 * Signal model:
 *   mic[n]  = voice[n] + echo[n]          (microphone input: voice + music echo)
 *   ref[n]  = music[n]                    (clean reference: the music being played)
 *   echo[n] ≈ h^T * ref[n..n-N+1]        (echo = room impulse response * reference)
 *   error[n] = mic[n] - h^T * ref         (residual = voice, what we want)
 *
 * NLMS weight update:
 *   h[n+1] = h[n] + mu * error[n] * ref_buf / (||ref_buf||^2 + epsilon)
 */
class AECProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    // Number of adaptive filter taps (models up to filterLength/sampleRate seconds of room delay)
    this.filterLength = opts.filterLength || 512
    // NLMS step size: 0 < mu < 2 for stability; ~0.5 balances speed and robustness
    this.mu = opts.mu !== undefined ? opts.mu : 0.5
    // Regularization to avoid division by zero when the reference signal is silent
    this.epsilon = 1e-8

    // Adaptive filter weights
    this.weights = new Float32Array(this.filterLength)
    // Circular reference signal buffer (newest sample at index 0)
    this.refBuffer = new Float32Array(this.filterLength)
    // Running power of the reference buffer (updated incrementally)
    this.refPower = 0
  }

  process(inputs, outputs) {
    const mic = inputs[0] && inputs[0][0]
    const ref = inputs[1] && inputs[1][0]
    const out = outputs[0] && outputs[0][0]

    if (!out) return true

    // No mic signal: output silence
    if (!mic) return true

    // No reference signal (no music playing): pass mic through unchanged
    if (!ref) {
      out.set(mic)
      return true
    }

    for (let i = 0; i < mic.length; i++) {
      // Remove the oldest sample from the running power before shifting.
      // Use Math.max(0, …) to guard against floating-point underflow making
      // the power slightly negative, which would destabilise the step size.
      const oldest = this.refBuffer[this.filterLength - 1]
      this.refPower = Math.max(0, this.refPower - oldest * oldest)

      // Shift the reference buffer right (newer samples at lower indices)
      this.refBuffer.copyWithin(1, 0, this.filterLength - 1)
      this.refBuffer[0] = ref[i]

      // Add the new sample's power
      this.refPower += ref[i] * ref[i]

      // Compute the estimated echo: h^T * refBuffer
      let estimatedEcho = 0
      for (let j = 0; j < this.filterLength; j++) {
        estimatedEcho += this.weights[j] * this.refBuffer[j]
      }

      // Error signal: mic minus estimated echo ≈ voice
      const error = mic[i] - estimatedEcho

      // NLMS weight update
      const stepSize = this.mu / (this.refPower + this.epsilon)
      for (let j = 0; j < this.filterLength; j++) {
        this.weights[j] += stepSize * error * this.refBuffer[j]
      }

      out[i] = error
    }

    return true
  }
}

registerProcessor("aec-processor", AECProcessor)
