import { describe, expect, test } from "bun:test";
import {
  anchorQuote,
  normalizeReaderText,
  spansOverlap,
  unionSpans,
} from "../../../shared/highlights/anchor";

const TEXT =
  "The marigold perimeter keeps aphids away. Plant it in spring. " +
  "In summer, the marigold perimeter needs water. By autumn the marigold " +
  "perimeter fades.";

const at = (text: string, quote: string, from = 0) => {
  const start = text.indexOf(quote, from);
  return { start, end: start + quote.length };
};

describe("anchorQuote", () => {
  test("finds an exact quote with the context around it", () => {
    const anchor = anchorQuote(TEXT, { quote: "Plant it in spring." });
    expect(anchor).toEqual({
      ...at(TEXT, "Plant it in spring."),
      prefix: TEXT.slice(at(TEXT, "Plant").start - 32, at(TEXT, "Plant").start),
      suffix: TEXT.slice(
        at(TEXT, "Plant it in spring.").end,
        at(TEXT, "Plant it in spring.").end + 32
      ),
    });
  });

  test("takes the first of repeats when nothing narrows it", () => {
    expect(anchorQuote(TEXT, { quote: "marigold perimeter" })?.start).toBe(
      at(TEXT, "marigold perimeter").start
    );
  });

  test("chooses between repeats by their context", () => {
    const second = at(TEXT, "marigold perimeter", 10);
    expect(
      anchorQuote(TEXT, {
        prefix: "In summer, the ",
        quote: "marigold perimeter",
        suffix: " needs water",
      })?.start
    ).toBe(second.start);
    const third = at(TEXT, "marigold perimeter", second.end);
    expect(
      anchorQuote(TEXT, { quote: "marigold perimeter", suffix: " fades." })
        ?.start
    ).toBe(third.start);
  });

  test("uses the offset hint between repeats with the same context", () => {
    const text = "one two. one two. one two.";
    expect(anchorQuote(text, { quote: "one two.", start: 17 })?.start).toBe(18);
    expect(anchorQuote(text, { quote: "one two.", start: 9 })?.start).toBe(9);
  });

  test("context outweighs a stale offset hint", () => {
    const second = at(TEXT, "marigold perimeter", 10);
    expect(
      anchorQuote(TEXT, {
        prefix: "By autumn the ",
        quote: "marigold perimeter",
        start: second.start,
      })?.start
    ).toBe(TEXT.lastIndexOf("marigold perimeter"));
  });

  test("matches across different whitespace", () => {
    const anchor = anchorQuote(TEXT, {
      quote: "Plant  it\n\nin   spring.",
    });
    expect(anchor && TEXT.slice(anchor.start, anchor.end)).toBe(
      "Plant it in spring."
    );
  });

  test("matches where the text has no space the quote has", () => {
    const text = "Name Age Ada36 Grace85";
    const anchor = anchorQuote(text, { quote: "Ada 36" });
    expect(anchor && text.slice(anchor.start, anchor.end)).toBe("Ada36");
  });

  test.each([
    ["curly quotes for straight ones", "It’s “fine”", `It's "fine"`],
    ["straight quotes for curly ones", `It's "fine"`, "It’s “fine”"],
    ["a dash style", "pages 4–5", "pages 4-5"],
    ["case", "THE GARDEN", "the garden"],
  ])("ignores %s", (_name, quote, inText) => {
    const text = `Before. ${inText} After.`;
    const anchor = anchorQuote(text, { quote });
    expect(anchor && text.slice(anchor.start, anchor.end)).toBe(inText);
  });

  test("returns null for a quote that isn't there", () => {
    expect(anchorQuote(TEXT, { quote: "tulips" })).toBeNull();
    expect(anchorQuote(TEXT, { quote: "   " })).toBeNull();
    expect(anchorQuote("", { quote: "tulips" })).toBeNull();
  });

  test("finds right-to-left text", () => {
    const text = "مقدمة قصيرة. الحديقة جميلة في الربيع. خاتمة.";
    const anchor = anchorQuote(text, { quote: "الحديقة جميلة" });
    expect(anchor && text.slice(anchor.start, anchor.end)).toBe(
      "الحديقة جميلة"
    );
    expect(anchor?.prefix).toBe("مقدمة قصيرة. ");
  });

  test("finds Japanese text, also across a line break", () => {
    const text = "庭の話。春にはマリーゴールドを植えます。夏は水やり。";
    const anchor = anchorQuote(text, { quote: "マリーゴールドを\n植えます" });
    expect(anchor && text.slice(anchor.start, anchor.end)).toBe(
      "マリーゴールドを植えます"
    );
  });

  test("keeps emoji whole", () => {
    const text = "Seeds 🌱 and sun ☀️ make a garden.";
    const anchor = anchorQuote(text, { quote: "🌱 and sun" });
    expect(anchor && text.slice(anchor.start, anchor.end)).toBe("🌱 and sun");
  });
});

describe("normalizeReaderText", () => {
  test("collapses whitespace runs and trims", () => {
    expect(normalizeReaderText("\n  Gardens\n\n\tgrow   slowly  ")).toBe(
      "Gardens grow slowly"
    );
  });
});

describe("unionSpans", () => {
  const text = "abcdefghijklmnopqrstuvwxyz";
  const span = (start: number, end: number) => ({
    start,
    end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - 3), start),
    suffix: text.slice(end, end + 3),
  });

  test("spans both, with the first one's prefix and the last one's suffix", () => {
    expect(unionSpans(span(5, 12), span(2, 8))).toEqual(span(2, 12));
    expect(unionSpans(span(2, 8), span(5, 12))).toEqual(span(2, 12));
  });

  test("is the outer one when one holds the other", () => {
    expect(unionSpans(span(2, 20), span(5, 8))).toEqual(span(2, 20));
    expect(unionSpans(span(5, 8), span(2, 20))).toEqual(span(2, 20));
  });

  test("overlap needs a shared character", () => {
    expect(spansOverlap(span(2, 5), span(5, 8))).toBe(false);
    expect(spansOverlap(span(2, 6), span(5, 8))).toBe(true);
  });
});
