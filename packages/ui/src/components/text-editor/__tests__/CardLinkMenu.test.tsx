import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CardLinkMenu } from "../CardLinkMenu";
import { cardLinkPillState, MISSING_CARD_LABEL } from "../CardLinkPill";

const noop = () => undefined;

describe("CardLinkMenu", () => {
  test("lists cards as options, marking the selected one", () => {
    const html = renderToStaticMarkup(
      <CardLinkMenu
        onChoose={noop}
        query="gar"
        selected={1}
        state={{
          items: [
            { id: "a", title: "Garden plan", type: "text" },
            { id: "b", title: "Garage sale", type: "link" },
          ],
          status: "ready",
        }}
      />
    );
    expect(html).toContain('aria-label="Link a card"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toContain("Garden plan");
    expect(html).toMatch(/aria-selected="true"[^>]*>.*Garage sale/);
  });

  test.each([
    ["gar", "No matching cards"],
    ["", "No cards yet"],
  ])("with no results for %p says %s", (query, message) => {
    const html = renderToStaticMarkup(
      <CardLinkMenu
        onChoose={noop}
        query={query}
        selected={0}
        state={{ items: [], status: "ready" }}
      />
    );
    expect(html).toContain(message);
    expect(html).not.toContain('role="option"');
  });

  test("shows a skeleton row while searching, and says when search failed", () => {
    expect(
      renderToStaticMarkup(
        <CardLinkMenu
          onChoose={noop}
          query="x"
          selected={0}
          state={{ status: "loading" }}
        />
      )
    ).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        <CardLinkMenu
          onChoose={noop}
          query="x"
          selected={0}
          state={{ status: "error" }}
        />
      )
    ).toContain("Couldn&#x27;t search cards");
  });
});

describe("card link pills", () => {
  const targets = new Map([
    ["live", { id: "live", missing: false, title: "Renamed", type: "text" }],
    ["gone", { id: "gone", missing: true, title: null, type: null }],
  ]);

  test("show the live title, the stored one while loading, or missing", () => {
    expect(cardLinkPillState("live", "Old", targets)).toMatchObject({
      missing: false,
      title: "Renamed",
    });
    expect(cardLinkPillState("live", "Old", undefined)).toMatchObject({
      missing: false,
      title: "Old",
    });
    expect(cardLinkPillState("gone", "Old", targets)).toMatchObject({
      missing: true,
      title: MISSING_CARD_LABEL,
    });
  });
});
