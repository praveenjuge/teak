/** The card grid's column rules, shared by the masonry and its skeletons. */

export const GRID_GUTTER = 16;
/** Narrow enough for two columns on a phone. */
export const MIN_COLUMN_WIDTH = 168;
/** As many as the Apple and Android grids show at their widest. */
export const MAX_COLUMNS = 5;

export const columnsForWidth = (width: number): number =>
  Math.min(
    MAX_COLUMNS,
    Math.max(
      1,
      Math.floor((width + GRID_GUTTER) / (MIN_COLUMN_WIDTH + GRID_GUTTER))
    )
  );

/**
 * `columnsForWidth` in CSS: at least `MIN_COLUMN_WIDTH` wide, at most
 * `MAX_COLUMNS`, so a plain CSS grid (the first paint, the loading skeleton)
 * has as many columns as the masonry it stands in for.
 */
export const GRID_COLUMNS_TEMPLATE = `repeat(auto-fill, minmax(max(${MIN_COLUMN_WIDTH}px, calc((100% - ${
  (MAX_COLUMNS - 1) * GRID_GUTTER
}px) / ${MAX_COLUMNS})), 1fr))`;
