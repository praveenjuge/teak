import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkedFromSection } from "../CardMetadataPanel";

const sources = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `card_${index}`,
    title: `Note ${index}`,
    type: "text",
  }));

describe("Linked from", () => {
  test("is hidden when nothing links here, or while loading", () => {
    expect(
      renderToStaticMarkup(
        <LinkedFromSection backlinks={{ backlinks: [], hasMore: false }} />
      )
    ).toBe("");
    expect(renderToStaticMarkup(<LinkedFromSection />)).toBe("");
  });

  test("lists each linking card as a button", () => {
    const html = renderToStaticMarkup(
      <LinkedFromSection
        backlinks={{ backlinks: sources(2), hasMore: false }}
        onOpenCard={() => undefined}
      />
    );
    expect(html).toContain('aria-label="Linked from"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Note 1");
    expect(html).not.toContain("and more");
  });

  test("ends with “and more” only when there are more than shown", () => {
    expect(
      renderToStaticMarkup(
        <LinkedFromSection
          backlinks={{ backlinks: sources(50), hasMore: true }}
        />
      )
    ).toContain("and more");
    expect(
      renderToStaticMarkup(
        <LinkedFromSection
          backlinks={{ backlinks: sources(50), hasMore: false }}
        />
      )
    ).not.toContain("and more");
  });
});
