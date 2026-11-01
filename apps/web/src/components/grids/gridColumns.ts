/** The card grid's column rules, shared by the masonry and its skeletons. */

export const GRID_GUTTER = 24;
export const MIN_COLUMN_WIDTH = 200;
export const MAX_COLUMNS = 5;

export const columnsForWidth = (width: number, gutter: number): number =>
  Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((width + gutter) / (MIN_COLUMN_WIDTH + gutter)))
  );

/**
 * `columnsForWidth` in CSS: at least MIN_COLUMN_WIDTH wide, at most
 * MAX_COLUMNS, so a plain CSS grid (the first paint, the loading skeleton)
 * has as many columns as the masonry it stands in for.
 */
export const gridColumnsTemplate = (gutter: number = GRID_GUTTER) =>
  `repeat(auto-fill, minmax(max(${MIN_COLUMN_WIDTH}px, calc((100% - ${
    (MAX_COLUMNS - 1) * gutter
  }px) / ${MAX_COLUMNS})), 1fr))`;
