import { describe, expect, test } from "bun:test";
import { parseLinkPreview } from "./parsing";

const baseUrl = "https://example.com/page";

describe("parseLinkPreview", () => {
  test("extracts title/description/image and resolves urls", () => {
    const parsed = parseLinkPreview(baseUrl, [
      {
        selector: "meta[property='og:title']",
        results: [{ attributes: [{ name: "content", value: "  Hello " }] }],
      },
      {
        selector: "meta[name='description']",
        results: [{ attributes: [{ name: "content", value: "  Desc " }] }],
      },
      {
        selector: "meta[property='og:image']",
        results: [{ attributes: [{ name: "content", value: "/image.png" }] }],
      },
    ]);

    expect(parsed.title).toBe("Hello");
    expect(parsed.description).toBe("Desc");
    expect(parsed.imageUrl).toBe("https://example.com/image.png");
    expect(parsed.finalUrl).toBe(baseUrl);
  });

  test("prefers Open Graph's title and description to the page's own", () => {
    const content = (selector: string, value: string) => ({
      selector,
      results: [{ attributes: [{ name: "content", value }] }],
    });
    const parsed = parseLinkPreview(baseUrl, [
      { selector: "head > title", results: [{ text: "Page title" }] },
      content("meta[name='twitter:title']", "Twitter title"),
      content("meta[property='og:title']", "Open Graph title"),
      content("meta[name='description']", "Page description"),
      content("meta[property='og:description']", "Open Graph description"),
    ]);

    expect(parsed.title).toBe("Open Graph title");
    expect(parsed.description).toBe("Open Graph description");
  });
});
