import { describe, expect, test } from "bun:test";
import { articlePlainText } from "../../shared/article";

describe("articlePlainText", () => {
  test("drops Markdown markup and keeps the words", () => {
    const markdown = [
      "# A heading",
      "",
      "> Quoted **bold** and _italic_",
      "",
      "- [x] Done item",
      "1. Numbered [link](https://example.com/a_(b))",
      "",
      "| Name | Count |",
      "| :--- | ---: |",
      "| Tent | 2 |",
      "",
      "---",
      "",
      "```js",
      "const x = 1;",
      "```",
      "![A photo](teak-image:0)",
    ].join("\n");
    expect(articlePlainText(markdown)).toBe(
      [
        "A heading",
        "",
        "Quoted bold and italic",
        "",
        "Done item",
        "Numbered link",
        "",
        "Name Count",
        "",
        "Tent 2",
        "",
        "const x = 1;",
        "",
        "A photo",
      ].join("\n")
    );
  });

  test("keeps blank lines and the line after a list marker apart", () => {
    expect(articlePlainText("-\nNot a list item")).toBe("-\nNot a list item");
    expect(articlePlainText("Before\n\n\n\n| --- |\nAfter")).toBe(
      "Before\n\nAfter"
    );
  });

  test("long runs of blank lines and spaces finish quickly", () => {
    for (const markdown of [
      `${"\n".repeat(200_000)}x`,
      `${" \n".repeat(100_000)}x`,
      `${" ".repeat(200_000)}x`,
      `\`\`\`\n${"\n".repeat(200_000)}\`\`\``,
      `${"| -- ".repeat(40_000)}x`,
      `${"-- ".repeat(60_000)}x`,
    ]) {
      const started = performance.now();
      articlePlainText(markdown);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
