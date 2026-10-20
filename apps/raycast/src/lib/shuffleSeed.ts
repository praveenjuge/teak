// A whole number the API takes as a shuffle seed: the same seed gives the same
// order on every page, and a new one reshuffles.
export const newShuffleSeed = (): number =>
  // Halving a random 32-bit value keeps every seed from 0 to 2^31 - 1 equally likely.
  Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2);
