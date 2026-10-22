/**
 * Visits `items` in order, loading each one's data in parallel batches no
 * larger than `wanted()`, the matches still needed. A batch never reaches past
 * the item a one-at-a-time scan would stop at, so it loads exactly what that
 * scan would, and stops visiting once `wanted()` reaches zero.
 */
export const scanInBatches = async <Item, Loaded>(
  items: readonly Item[],
  wanted: () => number,
  load: (item: Item) => Promise<Loaded>,
  visit: (item: Item, loaded: Loaded) => void
): Promise<void> => {
  let next = 0;
  while (next < items.length) {
    const size = wanted();
    if (size <= 0) {
      return;
    }
    const batch = items.slice(next, next + size);
    next += batch.length;
    const loaded = await Promise.all(batch.map(load));
    for (const [index, item] of batch.entries()) {
      if (wanted() <= 0) {
        return;
      }
      visit(item, loaded[index] as Loaded);
    }
  }
};
