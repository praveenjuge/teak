import { describe, expect, test } from "bun:test";
import { buildSelectorResultsFromHtml } from "../../linkMetadata/staticHtml";

const titleOf = (html: string) =>
  buildSelectorResultsFromHtml(html, [{ selector: "head > title" }])[0]
    .results[0]?.text;

const metaContentOf = (html: string) =>
  buildSelectorResultsFromHtml(html, [
    { selector: 'meta[property="og:title"]' },
  ])[0].results[0]?.attributes?.find((attr) => attr.name === "content")?.value;

describe("buildSelectorResultsFromHtml entity decoding", () => {
  test.each([
    ["&#x26;amp;", "&amp;"],
    ["&#38;lt;b&#38;gt;", "&lt;b&gt;"],
    ["&amp;lt;script&amp;gt;", "&lt;script&gt;"],
    ["Tom &amp; Jerry", "Tom & Jerry"],
    ["&lt;b&gt; &quot;hi&quot; &#39;x&#39; &#x41;&#66;", "<b> \"hi\" 'x' AB"],
    ["a&nbsp;b", "a b"],
    ["&unknown; stays", "&unknown; stays"],
  ])(
    "decodes %p in a title exactly once to %p",
    (encoded: string, decoded: string) => {
      expect(titleOf(`<title>${encoded}</title>`)).toBe(decoded);
    }
  );

  test("decodes meta attribute values exactly once", () => {
    expect(
      metaContentOf('<meta property="og:title" content="A &#x26;amp; B">')
    ).toBe("A &amp; B");
  });
});
