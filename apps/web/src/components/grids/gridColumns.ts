/** The card grid's column rules, shared by the masonry and its skeletons. */

export const GRID_GUTTER = 24;
export const MIN_COLUMN_WIDTH = 200;
export const MAX_COLUMNS = 5;

export const columnsForWidth = (
  width: number,
  gutter: number,
  minColumnWidth = MIN_COLUMN_WIDTH,
  maxColumns = MAX_COLUMNS
): number =>
  Math.min(
    maxColumns,
    Math.max(1, Math.floor((width + gutter) / (minColumnWidth + gutter)))
  );

/**
 * `columnsForWidth` in CSS: at least `minColumnWidth` wide, at most
 * `maxColumns`, so a plain CSS grid (the first paint, the loading skeleton)
 * has as many columns as the masonry it stands in for.
 */
export const gridColumnsTemplate = (
  gutter: number = GRID_GUTTER,
  minColumnWidth = MIN_COLUMN_WIDTH,
  maxColumns = MAX_COLUMNS
) =>
  `repeat(auto-fill, minmax(max(${minColumnWidth}px, calc((100% - ${
    (maxColumns - 1) * gutter
  }px) / ${maxColumns})), 1fr))`;
