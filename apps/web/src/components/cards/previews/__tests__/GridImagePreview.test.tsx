import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { GridImagePreview } = await import("../GridImagePreview");

const GRID = "https://files.teakvault.com/__images/v1/grid/u/c/a.jpg?sig=1";
const COMPACT =
  "https://files.teakvault.com/__images/v1/compact/u/c/a.jpg?sig=1";

describe("GridImagePreview", () => {
  test("loads lazily, at the shape of the picture before it arrives", () => {
    const markup = renderToStaticMarkup(
      <GridImagePreview height={300} imageUrl={GRID} width={400} />
    );
    expect(markup).toContain('loading="lazy"');
    expect(markup).toMatch(/aspect-ratio:\s*1\.33/);
  });

  test("loads a card above the fold first", () => {
    const markup = renderToStaticMarkup(
      <GridImagePreview imageUrl={GRID} isPriority />
    );
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('fetchPriority="high"');
  });

  test("offers the compact rendition for narrow columns, and no second request without one", () => {
    expect(
      renderToStaticMarkup(
        <GridImagePreview compactUrl={COMPACT} imageUrl={GRID} />
      )
    ).toContain(
      `srcSet="${COMPACT.replaceAll("&", "&amp;")} 256w, ${GRID} 512w"`
    );
    expect(
      renderToStaticMarkup(<GridImagePreview imageUrl={GRID} />)
    ).not.toContain("srcSet");
  });
});
