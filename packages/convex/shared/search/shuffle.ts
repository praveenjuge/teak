/**
 * Shuffle: a stable random order picked by a seed. The same seed gives the
 * same order on every page, reload and device; a new seed gives another.
 *
 * The library walks cards by their stored `shuffleKey` from a point the seed
 * picks (card/shuffle.ts). A bounded set of matches (a search, a tag, a
 * folder) is ordered by `shuffleRank` instead, which is the same for a card
 * and a seed whatever else is in the set, so a card saved mid-paging moves
 * nothing else.
 */

/** Seeds are integers from 0 to 2^31 - 1. */
export const MAX_SHUFFLE_SEED = 2 ** 31 - 1;

export const isShuffleSeed = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SHUFFLE_SEED;

/** A seed parsed from text, such as a URL or a query parameter. */
export const parseShuffleSeed = (
  value: string | null | undefined
): number | undefined => {
  if (!(value && /^\d{1,10}$/.test(value))) {
    return;
  }
  const seed = Number(value);
  return isShuffleSeed(seed) ? seed : undefined;
};

export const randomShuffleSeed = (): number =>
  Math.floor(Math.random() * (MAX_SHUFFLE_SEED + 1));

// biome-ignore-start lint/suspicious/noBitwiseOperators: 32-bit hashing needs them
// The murmur3 32-bit finalizer: spreads every input bit over the output.
const mix32 = (value: number): number => {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85_eb_ca_6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2_b2_ae_35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

/** Where the library walk starts for a seed, in [0, 1). */
export const shuffleStart = (seed: number): number =>
  mix32(seed ^ 0x9e_37_79_b9) / 2 ** 32;

/** Odd seeds walk the keys downward, even ones upward. */
export const shuffleDescends = (seed: number): boolean => seed % 2 === 1;

/** A card's place in a seeded shuffle of a set of matches. */
export const shuffleRank = (seed: number, id: string): number => {
  let hash = mix32(seed) ^ 0x81_1c_9d_c5;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01_00_01_93);
  }
  return mix32(hash);
};
// biome-ignore-end lint/suspicious/noBitwiseOperators: 32-bit hashing needs them

/** Orders items by their seeded rank; ties (vanishingly rare) by id. */
export const shuffleBySeed = <T>(
  items: readonly T[],
  seed: number,
  idOf: (item: T) => string
): T[] => {
  const ranked = items.map((item) => {
    const id = idOf(item);
    return { id, item, rank: shuffleRank(seed, id) };
  });
  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id < right.id ? -1 : 1;
  });
  return ranked.map((entry) => entry.item);
};
