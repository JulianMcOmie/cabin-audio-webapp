/** Convert Q factor to bandwidth in octaves. */
export function qToBandwidth(q: number): number {
  return (2 / Math.LN2) * Math.asinh(1 / (2 * q))
}
