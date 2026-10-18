import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  AUDIENCE_PAGE_LIST,
  AUDIENCE_PAGES,
  AUDIENCE_SLUGS,
  type AudiencePage,
  splitInlineCode,
  toPlainText,
} from "./audience-pages";
import { DEMO_COLUMNS } from "./home-demo-cards";

const pagesDir = path.join(import.meta.dir, "..", "pages");
const demoCardIds = new Set(DEMO_COLUMNS.flat().map((card) => card.id));

// Products these pages must never name: no comparisons, only Teak's own words.
const OTHER_PRODUCTS = [
  "Pinterest",
  "Notion",
  "Evernote",
  "Obsidian",
  "Roam",
  "Logseq",
  "Raindrop",
  "Pocket",
  "Instapaper",
  "Readwise",
  "mymind",
  "Are.na",
  "Milanote",
  "Eagle",
  "Dropbox",
  "Google Keep",
  "Apple Notes",
  "OneNote",
  "Bear",
  "Capacities",
  "Figma",
  "Dribbble",
  "ChatGPT",
  "Claude",
  "Cursor",
  "GitHub",
  "Chrome",
  "Firefox",
  "Safari",
];

const pageCopy = (page: AudiencePage) =>
  [
    page.navLabel,
    page.summary,
    page.title,
    page.description,
    page.h1,
    page.intro,
    page.featuresTitle,
    page.guide.label,
    ...page.features.flatMap((feature) => [feature.title, feature.description]),
    ...page.faqs.flatMap((faq) => [faq.question, faq.answer]),
  ].join("\n");

const pageCases = AUDIENCE_PAGE_LIST.map((page) => [page.slug, page] as const);

describe("audience pages", () => {
  test("every slug is unique and keyed by itself", () => {
    expect(new Set(AUDIENCE_SLUGS).size).toBe(AUDIENCE_SLUGS.length);
    for (const slug of AUDIENCE_SLUGS) {
      expect(AUDIENCE_PAGES[slug].slug).toBe(slug);
    }
  });

  test.each(pageCases)("%s has a page file at its slug", (slug) => {
    expect(existsSync(path.join(pagesDir, `${slug}.astro`))).toBe(true);
  });

  test("the page for saving without filing lives at /save-without-filing", () => {
    expect(AUDIENCE_SLUGS).toContain("save-without-filing");
    expect(AUDIENCE_PAGES["save-without-filing"].h1).toBe(
      "Save without filing"
    );
  });

  test.each(pageCases)("%s shows only demo cards that exist", (_, page) => {
    expect(page.demoCardIds.length).toBeGreaterThan(0);
    expect(page.demoCardIds.filter((id) => !demoCardIds.has(id))).toEqual([]);
    expect(new Set(page.demoCardIds).size).toBe(page.demoCardIds.length);
  });

  test.each(pageCases)(
    "%s keeps its title and description short enough for search results",
    (_, page) => {
      expect(`${page.title} | Teak`.length).toBeLessThanOrEqual(60);
      expect(toPlainText(page.description).length).toBeLessThanOrEqual(160);
    }
  );

  test.each(pageCases)(
    "%s has 3 to 6 features and at least 3 FAQs",
    (_, page) => {
      expect(page.features.length).toBeGreaterThanOrEqual(3);
      expect(page.features.length).toBeLessThanOrEqual(6);
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
    }
  );

  test.each(pageCases)("%s never names another product", (_, page) => {
    const copy = pageCopy(page);
    const named = OTHER_PRODUCTS.filter((product) =>
      new RegExp(`\\b${product.replace(".", "\\.")}\\b`, "i").test(copy)
    );

    expect(named).toEqual([]);
  });

  test.each(pageCases)(
    "%s closes every inline code span it opens",
    (_, page) => {
      const unbalanced = pageCopy(page)
        .split("\n")
        .filter((line) => (line.match(/`/g) ?? []).length % 2 !== 0);

      expect(unbalanced).toEqual([]);
    }
  );

  test.each(pageCases)("%s links its guide inside the docs", (_, page) => {
    expect(page.guide.href).toStartWith("/docs/");
  });
});

describe("inline code in page copy", () => {
  test("splits backticked text into code segments", () => {
    expect(splitInlineCode('Type `mood:"moody"` or `#3B82F6`.')).toEqual([
      { code: false, text: "Type " },
      { code: true, text: 'mood:"moody"' },
      { code: false, text: " or " },
      { code: true, text: "#3B82F6" },
      { code: false, text: "." },
    ]);
  });

  test("leaves text without backticks as one plain segment", () => {
    expect(splitInlineCode("No code here.")).toEqual([
      { code: false, text: "No code here." },
    ]);
  });

  test("plain text drops the backticks and keeps the words", () => {
    expect(toPlainText("Search `#secret` to see it.")).toBe(
      "Search #secret to see it."
    );
  });
});
