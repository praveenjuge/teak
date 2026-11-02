import type { ReactNode } from "react";
import { FirstPaintCopyContext } from "./firstPaintCopy";

/**
 * The grid's cells in plain CSS rows, for the server-rendered page. The
 * masonry measures its items in the browser before it can place them, so
 * this stands in until its first layout. It's inert: the masonry copy above
 * it holds focus and takes every interaction, and its cards are the only
 * ones that carry a card id.
 */
export function FirstPaintGrid<Item extends { key: string }>({
  gridTemplateColumns,
  gutter,
  items,
  renderItem,
}: {
  gridTemplateColumns: string;
  gutter: number;
  items: readonly Item[];
  renderItem: (item: Item) => ReactNode;
}) {
  return (
    <FirstPaintCopyContext value>
      <div
        aria-hidden="true"
        className="grid items-start"
        data-slot="first-paint-grid"
        inert
        style={{ gap: gutter, gridTemplateColumns }}
      >
        {items.map((item) => (
          <div key={item.key}>{renderItem(item)}</div>
        ))}
      </div>
    </FirstPaintCopyContext>
  );
}
