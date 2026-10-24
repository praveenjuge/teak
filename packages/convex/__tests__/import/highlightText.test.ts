import { describe, expect, test } from "bun:test";
import {
  parseOmnivoreHighlights,
  parseRaindropHighlights,
} from "../../import/highlightText";
import { cleanHighlights } from "../../import/sourceItems";
import { validateImportCard } from "../../import/validate";

describe("parseOmnivoreHighlights", () => {
  test("splits quote blocks; the lines after one are its note", () => {
    expect(
      parseOmnivoreHighlights(
        [
          "# Highlights of Gardens",
          "",
          "> Plant marigolds",
          "> around tomatoes.",
          "",
          "They keep aphids away.",
          "Really.",
          "",
          "> Water in the morning.",
          "",
          "> Third, no note",
        ].join("\r\n")
      )
    ).toEqual([
      {
        quote: "Plant marigolds\naround tomatoes.",
        note: "They keep aphids away.\nReally.",
      },
      { quote: "Water in the morning." },
      { quote: "Third, no note" },
    ]);
  });

  test("a file without a quote has no highlights", () => {
    expect(parseOmnivoreHighlights("just a note")).toEqual([]);
    expect(parseOmnivoreHighlights("")).toEqual([]);
  });

  test("an empty quote block is skipped", () => {
    expect(parseOmnivoreHighlights(">\n\nnote for nothing")).toEqual([]);
  });
});

describe("parseRaindropHighlights", () => {
  test("labelled highlights with notes, across lines", () => {
    expect(
      parseRaindropHighlights(
        "Highlight: first\nstill first\nNote: a note\n\nHighlight: second"
      )
    ).toEqual([
      { quote: "first\nstill first", note: "a note" },
      { quote: "second" },
    ]);
  });

  test("unlabelled text is one highlight per paragraph", () => {
    expect(parseRaindropHighlights("one\n\n two \n\n")).toEqual([
      { quote: "one" },
      { quote: "two" },
    ]);
    expect(parseRaindropHighlights("   ")).toEqual([]);
  });
});

describe("cleanHighlights", () => {
  test("keeps the first 200, drops long and empty quotes, cuts long notes", () => {
    const many = Array.from({ length: 250 }, (_, index) => ({
      quote: `q${index}`,
    }));
    const cleaned = cleanHighlights([
      { quote: "   " },
      { quote: "x".repeat(5001) },
      { quote: "kept", note: "n".repeat(2500) },
      ...many,
    ]);
    expect(cleaned).toHaveLength(200);
    expect(cleaned?.[0]).toEqual({ quote: "kept", note: "n".repeat(2000) });
    expect(cleaned?.[1]).toEqual({ quote: "q0" });
    expect(cleaned?.at(-1)).toEqual({ quote: "q198" });
  });
});

describe("validateImportCard highlights", () => {
  const link = (highlights: unknown) =>
    validateImportCard({
      type: "link",
      content: "A",
      url: "https://example.com/a",
      highlights,
    });

  test("keeps a link's highlights and drops empty quotes", () => {
    expect(
      link([
        { quote: " A passage ", note: " why " },
        { quote: "" },
        { quote: "B", note: null },
      ]).highlights
    ).toEqual([{ quote: "A passage", note: "why" }, { quote: "B" }]);
  });

  test("refuses more than 200, a long quote or note, and bad shapes", () => {
    expect(() =>
      link(Array.from({ length: 201 }, () => ({ quote: "x" })))
    ).toThrow("highlights");
    expect(() => link([{ quote: "x".repeat(5001) }])).toThrow("5,000");
    expect(() => link([{ quote: "x", note: "n".repeat(2001) }])).toThrow(
      "2,000"
    );
    expect(() => link([{ note: "no quote" }])).toThrow("highlights");
    expect(() => link("not a list")).toThrow("highlights");
  });

  test("only a link keeps highlights", () => {
    expect(
      validateImportCard({
        type: "text",
        content: "note",
        highlights: [{ quote: "x" }],
      }).highlights
    ).toBeUndefined();
  });
});
