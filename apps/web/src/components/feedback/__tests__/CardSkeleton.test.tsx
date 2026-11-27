import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GRID_COLUMNS_TEMPLATE } from "../../grids/gridColumns";
import { CardsGridSkeleton } from "../CardSkeleton";

test("the loading grid uses the card grid's own column rules, so nothing jumps when cards load", () => {
  const html = renderToStaticMarkup(<CardsGridSkeleton />);

  expect(html).toContain('role="status"');
  expect(html).toContain(`grid-template-columns:${GRID_COLUMNS_TEMPLATE}`);
  expect(html).toContain("gap:16px");
});
