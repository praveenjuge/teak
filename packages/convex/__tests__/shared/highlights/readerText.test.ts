import { describe, expect, test } from "bun:test";
import { markdownToReaderText } from "../../../shared/highlights/readerText";

describe("markdownToReaderText", () => {
  test("joins blocks with one space and drops markup", () => {
    expect(
      markdownToReaderText(
        [
          "## Spring",
          "",
          "Plant **marigolds** with _care_ and [water](https://example.com).",
          "",
          "- one",
          "- two",
          "",
          "> A quote",
        ].join("\n")
      )
    ).toBe("Spring Plant marigolds with care and water. one two A quote");
  });

  test("drops an opening heading that repeats the title", () => {
    expect(
      markdownToReaderText("# Gardens\n\nThe body.", { title: "gardens" })
    ).toBe("The body.");
    expect(
      markdownToReaderText("# Gardens\n\nThe body.", { title: "Other" })
    ).toBe("Gardens The body.");
  });

  test("keeps captions of the article's own images and nothing of others", () => {
    expect(
      markdownToReaderText(
        [
          'Before ![alt text](teak-image:0 "A caption").',
          "",
          '![missing](teak-image:3 "Gone caption") ![web](https://x.test/a.png "Web caption")',
          "",
          "After.",
        ].join("\n"),
        { imageCount: 1 }
      )
    ).toBe("Before A caption. After.");
  });

  test("puts table cells side by side, as the page does", () => {
    expect(
      markdownToReaderText("| Name | Age |\n| --- | --- |\n| Ada | 36 |")
    ).toBe("NameAgeAda36");
  });

  test("leaves raw HTML out but keeps its text", () => {
    expect(
      markdownToReaderText("Keep <b>bold</b> text.\n\n<script>x()</script>")
    ).toBe("Keep bold text.");
  });

  test("keeps code as written", () => {
    expect(markdownToReaderText("Run `bun test`:\n\n```\nbun  test\n```")).toBe(
      "Run bun test: bun test"
    );
  });
});
