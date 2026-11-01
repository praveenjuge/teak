import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { gridColumnsTemplate } from "../../grids/gridColumns";
import { CardsGridSkeleton } from "../CardSkeleton";

test("the loading grid uses the card grid's own column rules, so nothing jumps when cards load", () => {
  const html = renderToStaticMarkup(<CardsGridSkeleton />);

  expect(html).toContain('role="status"');
  expect(html).toContain(`grid-template-columns:${gridColumnsTemplate(24)}`);
  expect(html).toContain("gap:24px");
  expect(html).not.toMatch(/(?:md|lg):grid-cols-/);
});
