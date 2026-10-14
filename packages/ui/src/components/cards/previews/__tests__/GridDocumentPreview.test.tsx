import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Convex is the boundary: the thumbnail only asks it for a fresh URL when an
// image fails, which static rendering never does.
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { GridDocumentPreview } = await import("../GridDocumentPreview");

const thumbnail = "https://files.teakvault.com/page-1.jpg";

describe("GridDocumentPreview", () => {
  test("reserves the page's shape, or a portrait page when it is unknown", () => {
    const sized = renderToStaticMarkup(
      <GridDocumentPreview height={600} thumbnailUrl={thumbnail} width={800} />
    );
    const unsized = renderToStaticMarkup(
      <GridDocumentPreview thumbnailUrl={thumbnail} />
    );
    expect(sized).toContain("aspect-ratio:1.3333333333333333");
    expect(unsized).toContain("aspect-ratio:0.75");
  });

  test("lazy-loads thumbnails below the fold and prioritizes those above it", () => {
    const lazy = renderToStaticMarkup(
      <GridDocumentPreview thumbnailUrl={thumbnail} />
    );
    const eager = renderToStaticMarkup(
      <GridDocumentPreview isPriority thumbnailUrl={thumbnail} />
    );
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).not.toContain("fetchPriority");
    expect(eager).toContain('loading="eager"');
    expect(eager).toContain('fetchPriority="high"');
  });

  test("names the file with its format badge", () => {
    const markup = renderToStaticMarkup(
      <GridDocumentPreview fileName="Annual report.pdf" formatBadge="PDF" />
    );
    expect(markup).toContain("Annual report.pdf");
    expect(markup).toContain(">PDF<");
  });
});
