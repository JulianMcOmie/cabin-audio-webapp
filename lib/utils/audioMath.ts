/** Convert decibels to linear gain. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
