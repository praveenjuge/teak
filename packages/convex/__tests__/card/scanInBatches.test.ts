import { describe, expect, test } from "bun:test";
import { scanInBatches } from "../../card/scanInBatches";

const scanSequentially = (
  items: readonly number[],
  limit: number,
  accepts: (item: number) => boolean
) => {
  const loaded: number[] = [];
  const kept: number[] = [];
  for (const item of items) {
    if (kept.length >= limit) {
      break;
    }
    loaded.push(item);
    if (accepts(item)) {
      kept.push(item);
    }
  }
  return { loaded, kept };
};

const scanBatched = async (
  items: readonly number[],
  limit: number,
  accepts: (item: number) => boolean
) => {
  const loaded: number[] = [];
  const kept: number[] = [];
  await scanInBatches(
    items,
    () => limit - kept.length,
    (item) => {
      loaded.push(item);
      return Promise.resolve(accepts(item));
    },
    (item, accepted) => {
      if (accepted) {
        kept.push(item);
      }
    }
  );
  return { loaded, kept };
};

const items = Array.from({ length: 40 }, (_, index) => index);

describe("scanInBatches", () => {
  test.each([
    ["every item matches", () => true, 5],
    ["every third item matches", (item: number) => item % 3 === 0, 6],
    ["matches cluster at the end", (item: number) => item > 30, 4],
    ["nothing matches", () => false, 5],
    ["more wanted than there are items", () => true, 100],
  ])(
    "loads and keeps what a one-by-one scan would when %s",
    async (_name, accepts, limit) => {
      const sequential = scanSequentially(items, limit, accepts);
      const batched = await scanBatched(items, limit, accepts);

      expect(batched.kept).toEqual(sequential.kept);
      expect([...batched.loaded].sort((a, b) => a - b)).toEqual(
        sequential.loaded
      );
    }
  );

  test("loads nothing when no matches are wanted", async () => {
    const batched = await scanBatched(items, 0, () => true);

    expect(batched).toEqual({ loaded: [], kept: [] });
  });
});
