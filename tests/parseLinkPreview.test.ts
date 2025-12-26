// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { parseLinkPreview } from "../convex/linkMetadata/parsing";

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
});
