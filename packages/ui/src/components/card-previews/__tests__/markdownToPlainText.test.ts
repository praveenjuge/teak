import { describe, expect, test } from "bun:test";
import { markdownToPlainText } from "../../../lib/markdownToPlainText";

describe("markdownToPlainText", () => {
  test("returns an empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
    expect(markdownToPlainText(undefined)).toBe("");
    expect(markdownToPlainText(null)).toBe("");
  });

  test("strips leading heading markers", () => {
    expect(markdownToPlainText("# Hello world")).toBe("Hello world");
    expect(markdownToPlainText("### Deep heading")).toBe("Deep heading");
  });

  test("removes HTML comments", () => {
    expect(
      markdownToPlainText("# Vadivam <!-- vadivam-icon-count:start -->")
    ).toBe("Vadivam");
  });

  test("flattens list markers and collapses whitespace", () => {
    expect(markdownToPlainText("- asda - sda - sd")).toBe("asda - sda - sd");
    expect(markdownToPlainText("1. First\n2. Second")).toBe("First Second");
  });

  test("keeps link and image text without the markup", () => {
    expect(markdownToPlainText("See [the docs](https://example.com)")).toBe(
      "See the docs"
    );
    expect(markdownToPlainText("![alt text](https://example.com/x.png)")).toBe(
      "alt text"
    );
  });

  test("removes inline emphasis and code markers", () => {
    expect(markdownToPlainText("**bold** and *italic* and `code`")).toBe(
      "bold and italic and code"
    );
  });

  test("cleans up single-line markdown documents", () => {
    expect(
      markdownToPlainText("# AGENTS.md ## Project Overview Vadivam is a Bun")
    ).toBe("AGENTS.md Project Overview Vadivam is a Bun");
  });

  test("preserves plain text unchanged", () => {
    expect(markdownToPlainText("Blog post ideas - I forget CSS")).toBe(
      "Blog post ideas - I forget CSS"
    );
  });

  test("unescapes markdown escapes the editor adds", () => {
    expect(markdownToPlainText("my\\_file\\_name\\_v2 costs 2\\*3")).toBe(
      "my_file_name_v2 costs 2*3"
    );
  });

  test("keeps escaped emphasis markers as literal text", () => {
    expect(markdownToPlainText("\\*\\*bold\\*\\* and \\_x\\_")).toBe(
      "**bold** and _x_"
    );
  });

  test("keeps escaped heading, list and link characters", () => {
    expect(markdownToPlainText("\\# not a heading")).toBe("# not a heading");
    expect(markdownToPlainText("\\- not a bullet")).toBe("- not a bullet");
    expect(markdownToPlainText("\\[label\\](x) and C:\\\\dir")).toBe(
      "[label](x) and C:\\dir"
    );
  });

  test("shows [[…]] card links as their titles", () => {
    const id = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
    expect(
      markdownToPlainText(`Plan: [[Garden plan|teak:${id}]] and **more**`)
    ).toBe("Plan: Garden plan and more");
    expect(
      markdownToPlainText(
        `${"[[Long title here|teak:".repeat(1)}${id}]] `.repeat(40),
        {
          maxLength: 60,
        }
      )
    ).toBe("Long title here ".repeat(4).slice(0, 60).trim());
  });
});
