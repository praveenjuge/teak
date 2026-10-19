export const MAX_SHUFFLE_SEED = 2 ** 31 - 1;

export const isShuffleSeed = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SHUFFLE_SEED;

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

const murmur3Fmix32 = (value: number): number => {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85_eb_ca_6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2_b2_ae_35);
  hash ^= hash >>> 16;
  return hash >>> 0;
};

export const shuffleStart = (seed: number): number =>
  murmur3Fmix32(seed ^ 0x9e_37_79_b9) / 2 ** 32;

export const shuffleDescends = (seed: number): boolean => seed % 2 === 1;

export const shuffleRank = (seed: number, id: string): number => {
  let hash = murmur3Fmix32(seed) ^ 0x81_1c_9d_c5;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01_00_01_93);
  }
  return murmur3Fmix32(hash);
};

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
