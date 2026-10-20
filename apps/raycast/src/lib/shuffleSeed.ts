// A whole number the API takes as a shuffle seed: the same seed gives the same
// order on every page, and a new one reshuffles.
export const newShuffleSeed = (): number =>
  crypto.getRandomValues(new Uint32Array(1))[0] % 2_147_483_648;
