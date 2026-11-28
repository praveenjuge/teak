import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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

  test("keeps a page taller than 3:4 at 3:4, so its top stays in the tile", () => {
    const receipt = renderToStaticMarkup(
      <GridDocumentPreview height={900} thumbnailUrl={thumbnail} width={300} />
    );
    expect(receipt).toContain("aspect-ratio:0.75");
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

  test("names the file and its format in the footer, with the card's marks", () => {
    const markup = renderToStaticMarkup(
      <GridDocumentPreview
        fileName="Annual report.pdf"
        formatBadge="PDF"
        marks={<span data-mark="" />}
        thumbnailUrl={thumbnail}
      />
    );
    const footer = markup.slice(markup.indexOf("data-card-footer"));
    expect(footer).toContain(">Annual report.pdf</p>");
    expect(footer).toContain(">PDF</span>");
    expect(footer).toContain("data-mark");
  });

  test("draws the format on the empty page dark enough to read", () => {
    const markup = renderToStaticMarkup(
      <GridDocumentPreview fileName="Notes.txt" formatBadge="TXT" />
    );
    const page = markup.slice(0, markup.indexOf("data-card-footer"));
    expect(page).toContain(
      'font-semibold text-foreground/70 text-xs tracking-wide">TXT</span>'
    );
  });
});
