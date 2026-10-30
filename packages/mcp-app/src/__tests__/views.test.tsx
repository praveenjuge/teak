import { describe, expect, test } from "bun:test";
import { SUPPORTED_LOCALES } from "@teak/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type AppMessages,
  createAppTranslator,
  resolveAppLocale,
} from "../i18n";
import { type CardView, viewFromToolResult } from "../model";
import { TeakView } from "../views";
import { linkCard, noteCard, paletteCard } from "./fixtures";

const catalog = async (locale: string): Promise<AppMessages> => {
  const messages = (await import(`../../../i18n/messages/${locale}.json`))
    .default as AppMessages;
  return { cards: { types: messages.cards.types }, mcpApp: messages.mcpApp };
};

const render = async (view: CardView, locale = "en") => {
  const messages = await catalog(locale);
  const opened: string[] = [];
  const html = renderToStaticMarkup(
    <TeakView
      messages={messages}
      onOpen={(url) => opened.push(url)}
      t={createAppTranslator(resolveAppLocale(locale), messages)}
      view={view}
    />
  );
  return { html, opened };
};

const search = viewFromToolResult({
  input: { q: "fonts" },
  result: { structuredContent: { items: [linkCard, noteCard, paletteCard] } },
  toolName: "teak_v1_search_cards",
});

describe("TeakView", () => {
  test("lists search results with images, titles and favorites", async () => {
    const { html } = await render(search);
    expect(html).toContain("Results for “fonts”");
    expect(html).toContain("3 cards");
    expect(html).toContain(
      'src="https://files.teakvault.com/r2/k1.webp?exp=1&amp;sig=a"'
    );
    expect(html).toContain("Variable fonts, explained");
    expect(html).toContain("Launch checklist");
    expect(html).toContain('aria-label="Favorite"');
    expect(html).toContain("background-color:#1F2937");
  });

  test("shows an empty list", async () => {
    const { html } = await render({
      cards: [],
      kind: "list",
      query: null,
      source: "favorites",
    });
    expect(html).toContain("Favorites");
    expect(html).toContain("No cards match.");
  });

  test("shows a card with its summary, notes, tags and both links", async () => {
    const { html } = await render(
      viewFromToolResult({ result: { structuredContent: linkCard } })
    );
    expect(html).toContain("A field guide to variable fonts on the web.");
    expect(html).toContain("Read before the redesign");
    expect(html).toContain("#typography");
    expect(html).toContain("Open in Teak");
    expect(html).toContain("Visit source");
  });

  test("confirms a save, and says when the link was already saved", async () => {
    const saved = (resaved: boolean) =>
      render(
        viewFromToolResult({
          result: {
            structuredContent: { card: linkCard, resaved, status: "created" },
          },
        })
      );
    expect((await saved(false)).html).toContain("Saved to Teak");
    expect((await saved(true)).html).toContain(
      "Already in Teak, moved to the top"
    );
  });

  test.each(SUPPORTED_LOCALES.filter((locale) => locale !== "en"))(
    "renders every view in %s without English",
    async (locale) => {
      const english = await catalog("en");
      const own = await catalog(locale);
      const views: CardView[] = [
        search,
        { cards: [], kind: "list", query: null, source: "recent" },
        viewFromToolResult({ result: { structuredContent: linkCard } }),
        { kind: "error" },
        { kind: "loading" },
      ];
      for (const view of views) {
        const { html } = await render(view, locale);
        for (const key of [
          "openInTeak",
          "recentTitle",
          "loading",
          "error",
        ] as const) {
          if (own.mcpApp[key] !== english.mcpApp[key]) {
            expect(html).not.toContain(english.mcpApp[key]);
          }
        }
      }
      expect((await render(search, locale)).html).toContain(
        own.mcpApp.searchTitle.replace("{query}", "fonts")
      );
    }
  );
});

describe("resolveAppLocale", () => {
  test.each([
    ["en-US", "en"],
    ["pt-PT", "pt-BR"],
    ["zh-CN", "zh-Hans"],
    ["zh-Hant-TW", "en"],
    ["ja-JP", "ja"],
    ["fr", "fr"],
    ["nl-NL", "en"],
    [undefined, "en"],
  ])("maps %s to %s", (hostLocale, locale) => {
    expect(resolveAppLocale(hostLocale)).toBe(locale as never);
  });
});

describe("text previews", () => {
  test("a note shows its text once, without Markdown marks", async () => {
    const { html } = await render(
      viewFromToolResult({
        result: { structuredContent: { items: [noteCard] } },
      })
    );
    expect(html).not.toContain("# Launch");
    expect(html.match(/Launch checklist/gu)).toHaveLength(1);
  });

  test("a note's detail titles it by its first line and shows the rest", async () => {
    const { html } = await render(
      viewFromToolResult({ result: { structuredContent: noteCard } })
    );
    expect(html).toContain("<h1>Launch checklist</h1>");
    expect(html).toContain("Ship the connector, then the plugin.");
    expect(html.match(/Launch checklist/gu)).toHaveLength(1);
  });
});

describe("cards without a title", () => {
  test("show their type, not a placeholder title", async () => {
    const { html } = await render(
      viewFromToolResult({
        result: {
          structuredContent: {
            items: [{ ...paletteCard, metadataTitle: null }],
          },
        },
      })
    );
    expect(html).not.toContain('class="title"');
    expect(html).toContain("Palette");
  });
});
