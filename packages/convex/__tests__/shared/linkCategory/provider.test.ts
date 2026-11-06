import { expect, test } from "bun:test";
import { detectProvider } from "../../../shared/linkCategory/enrichment";
import {
  providerForHostname,
  resolveLinkCategory,
} from "../../../shared/utils/linkCategoryResolver";

test.each([
  ["https://github.com/microsoft/vscode", "github"],
  ["https://www.amazon.co.uk/dp/B000", "amazon"],
  ["https://m.imdb.com/title/tt0111161/", "imdb"],
  ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
  ["https://open.spotify.com/track/1", "spotify"],
  ["https://music.apple.com/us/album/1", "apple"],
  ["https://www.netflix.com/title/1", "netflix"],
  ["https://www.behance.net/gallery/1", "behance"],
  ["https://someone.substack.com/p/post", "substack"],
  // Before one table, a link without the classifier's hint named its host,
  // so these never reached their site's details.
  ["https://en.wikipedia.org/wiki/Teak", "wikipedia"],
  ["https://arxiv.org/abs/2401.00001", "arxiv"],
  ["https://example.com/page", "example.com"],
])("the provider of %p is %p", (url, provider) => {
  expect(detectProvider(url)).toBe(provider);
});

test("the classifier's hint wins", () => {
  expect(detectProvider("https://example.com", "goodreads")).toBe("goodreads");
});

test("the category resolver and detectProvider name the same provider", () => {
  for (const url of [
    "https://github.com/microsoft",
    "https://www.goodreads.com/book/show/1",
    "https://en.wikipedia.org/wiki/Teak",
    "https://www.figma.com/community/file/1",
  ]) {
    const { provider } = resolveLinkCategory(url);
    expect(provider).toBeDefined();
    expect(detectProvider(url)).toBe(provider as string);
    expect(providerForHostname(new URL(url).hostname)).toBe(provider);
  }
});
