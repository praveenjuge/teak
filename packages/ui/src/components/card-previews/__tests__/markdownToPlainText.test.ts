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
});
