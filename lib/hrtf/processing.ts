export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function getFilterMixGains(filterEnabled: boolean, filterIntensity: number) {
  const wetAmount = filterEnabled ? clamp01(filterIntensity) : 0
  return {
    wetGain: Math.sin(wetAmount * Math.PI * 0.5),
    dryGain: Math.cos(wetAmount * Math.PI * 0.5),
  }
}

export function applyDifferenceReduction(left: number[], right: number[], reduction: number) {
  const mix = clamp01(reduction)
  const nextLeft = new Float32Array(left.length)
  const nextRight = new Float32Array(right.length)

  for (let index = 0; index < left.length; index += 1) {
    const average = (left[index] + right[index]) * 0.5
    nextLeft[index] = left[index] * (1 - mix) + average * mix
    nextRight[index] = right[index] * (1 - mix) + average * mix
  }

  return {
    left: nextLeft,
    right: nextRight,
  }
}

export function buildEffectiveImpulse(impulse: Float32Array, dryGain: number, wetGain: number) {
  const mixed = new Float32Array(impulse.length)

  for (let index = 0; index < impulse.length; index += 1) {
    mixed[index] = impulse[index] * wetGain
  }

  if (mixed.length > 0) {
    mixed[0] += dryGain
  }

  return mixed
}

function nextPowerOfTwo(value: number) {
  let size = 1
  while (size < value) {
    size *= 2
  }
  return size
}

function dftReal(signal: Float32Array, size: number) {
  const real = new Float32Array(size)
  const imaginary = new Float32Array(size)

  for (let frequencyBin = 0; frequencyBin < size; frequencyBin += 1) {
    let sumReal = 0
    let sumImaginary = 0

    for (let sampleIndex = 0; sampleIndex < signal.length; sampleIndex += 1) {
      const angle = (-2 * Math.PI * frequencyBin * sampleIndex) / size
      const sample = signal[sampleIndex]
      sumReal += sample * Math.cos(angle)
      sumImaginary += sample * Math.sin(angle)
    }

    real[frequencyBin] = sumReal
    imaginary[frequencyBin] = sumImaginary
  }

  return { real, imaginary }
}

function idftReal(real: Float32Array, imaginary: Float32Array, outputLength: number) {
  const size = real.length
  const output = new Float32Array(outputLength)

  for (let sampleIndex = 0; sampleIndex < outputLength; sampleIndex += 1) {
    let sum = 0

    for (let frequencyBin = 0; frequencyBin < size; frequencyBin += 1) {
      const angle = (2 * Math.PI * frequencyBin * sampleIndex) / size
      sum += real[frequencyBin] * Math.cos(angle) - imaginary[frequencyBin] * Math.sin(angle)
    }

    output[sampleIndex] = sum / size
  }

  return output
}

function normalizePair(left: Float32Array, right: Float32Array) {
  let peak = 1e-8

  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]))
  }

  const scale = 0.95 / peak
  const normalizedLeft = new Float32Array(left.length)
  const normalizedRight = new Float32Array(right.length)

  for (let index = 0; index < left.length; index += 1) {
    normalizedLeft[index] = left[index] * scale
    normalizedRight[index] = right[index] * scale
  }

  return {
    left: normalizedLeft,
    right: normalizedRight,
  }
}

export function normalizeStereoPair(left: Float32Array, right: Float32Array) {
  return normalizePair(left, right)
}

function interpolateCurveDb(frequency: number, controlFrequencies: number[], magnitudeDb: number[]) {
  if (controlFrequencies.length === 0 || controlFrequencies.length !== magnitudeDb.length) {
    return 0
  }

  if (frequency <= controlFrequencies[0]) {
    return magnitudeDb[0]
  }

  const lastIndex = controlFrequencies.length - 1
  if (frequency >= controlFrequencies[lastIndex]) {
    return magnitudeDb[lastIndex]
  }

  for (let index = 1; index < controlFrequencies.length; index += 1) {
    const currentFrequency = controlFrequencies[index]
    if (frequency <= currentFrequency) {
      const previousFrequency = controlFrequencies[index - 1]
      const ratio = (frequency - previousFrequency) / (currentFrequency - previousFrequency)
      return magnitudeDb[index - 1] + (magnitudeDb[index] - magnitudeDb[index - 1]) * ratio
    }
  }

  return magnitudeDb[lastIndex]
}

export function synthesizeImpulseFromCurve(
  controlFrequencies: number[],
  magnitudeDb: number[],
  sampleRate: number,
  length: number,
  delaySamples: number
) {
  const fftSize = nextPowerOfTwo(Math.max(length * 2, 256))
  const real = new Float32Array(fftSize)
  const imaginary = new Float32Array(fftSize)
  const nyquistBin = fftSize / 2

  for (let frequencyBin = 0; frequencyBin <= nyquistBin; frequencyBin += 1) {
    const frequency = (frequencyBin * sampleRate) / fftSize
    const magnitude = Math.pow(10, interpolateCurveDb(frequency, controlFrequencies, magnitudeDb) / 20)
    const phase = (-2 * Math.PI * frequencyBin * delaySamples) / fftSize
    const binReal = magnitude * Math.cos(phase)
    const binImaginary = magnitude * Math.sin(phase)

    real[frequencyBin] = binReal
    imaginary[frequencyBin] = binImaginary

    if (frequencyBin > 0 && frequencyBin < nyquistBin) {
      real[fftSize - frequencyBin] = binReal
      imaginary[fftSize - frequencyBin] = -binImaginary
    }
  }

  return idftReal(real, imaginary, length)
}

export function removeSharedMagnitude(left: Float32Array, right: Float32Array) {
  const fftSize = nextPowerOfTwo(Math.max(left.length, right.length))
  const leftSpectrum = dftReal(left, fftSize)
  const rightSpectrum = dftReal(right, fftSize)
  const nextLeftReal = new Float32Array(fftSize)
  const nextLeftImaginary = new Float32Array(fftSize)
  const nextRightReal = new Float32Array(fftSize)
  const nextRightImaginary = new Float32Array(fftSize)

  for (let frequencyBin = 0; frequencyBin < fftSize; frequencyBin += 1) {
    const leftReal = leftSpectrum.real[frequencyBin]
    const leftImaginary = leftSpectrum.imaginary[frequencyBin]
    const rightReal = rightSpectrum.real[frequencyBin]
    const rightImaginary = rightSpectrum.imaginary[frequencyBin]

    const leftMagnitude = Math.max(1e-8, Math.hypot(leftReal, leftImaginary))
    const rightMagnitude = Math.max(1e-8, Math.hypot(rightReal, rightImaginary))
    const sharedMagnitude = Math.max(1e-8, Math.sqrt(leftMagnitude * rightMagnitude))

    const leftScale = leftMagnitude / sharedMagnitude / leftMagnitude
    const rightScale = rightMagnitude / sharedMagnitude / rightMagnitude

    nextLeftReal[frequencyBin] = leftReal * leftScale
    nextLeftImaginary[frequencyBin] = leftImaginary * leftScale
    nextRightReal[frequencyBin] = rightReal * rightScale
    nextRightImaginary[frequencyBin] = rightImaginary * rightScale
  }

  const reconstructedLeft = idftReal(nextLeftReal, nextLeftImaginary, left.length)
  const reconstructedRight = idftReal(nextRightReal, nextRightImaginary, right.length)

  return normalizePair(reconstructedLeft, reconstructedRight)
}
