import { describe, expect, test } from "bun:test";
import {
  linkNoteText,
  markdownToPlainText,
} from "../../../lib/markdownToPlainText";

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

  test("keeps a link's title literal, Markdown punctuation and all", () => {
    const id = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
    expect(
      markdownToPlainText(
        `See [[my_snake_case *notes* <b>|teak:${id}]] and **more**`
      )
    ).toBe("See my_snake_case *notes* <b> and more");
  });

  test("never ends a cut link title in a stray backslash", () => {
    const id = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
    const preview = markdownToPlainText(`See [[my_notes|teak:${id}]]`, {
      maxLength: 7,
    });
    expect(preview).not.toContain("\\");
    expect(preview).toBe("See my_");
  });

  test("never ends a cut escape in a stray backslash", () => {
    const preview = markdownToPlainText("see my\\_file", { maxLength: 7 });
    expect(preview).not.toContain("\\");
    expect(preview).toBe("see my_");
  });

  test("never shows a link token the length cut splits", () => {
    const id = "k17a8m9x2p3q4r5s6t7u8v9w0y1z2a3b";
    const preview = markdownToPlainText(`[[a|teak:${id}]] `.repeat(300), {
      maxLength: 1000,
    });
    expect(preview).not.toContain("teak:");
    expect(preview).toMatch(/^a( a)+$/);
  });

  // The editor saves `<`, `>` and `&` as entities (bug 01).
  test.each([
    ["math: 3 &lt; 5 &amp; 7 &gt; 2", "math: 3 < 5 & 7 > 2"],
    ["&lt;b&gt;not bold&lt;/b&gt;", "<b>not bold</b>"],
    ["&gt; words of wisdom", "> words of wisdom"],
    ["Tom &amp; Jerry", "Tom & Jerry"],
    ["&#60;tag&#62; and &#x3C;hex&#x3E;", "<tag> and <hex>"],
    ["&quot;hi&quot; &apos;there&apos;", "\"hi\" 'there'"],
    ["wait&hellip; &mdash; &copy; &rsquo;", "wait… — © ’"],
    ["&#0; and &#xD800;", "\uFFFD and \uFFFD"],
  ])("decodes entities in %p", (input, expected) => {
    expect(markdownToPlainText(input)).toBe(expected);
  });

  test("decodes each entity once, so an escaped entity reads as typed", () => {
    expect(markdownToPlainText("&amp;lt; is how you write &amp;amp;")).toBe(
      "&lt; is how you write &amp;"
    );
  });

  test("keeps decoded characters out of Markdown rules", () => {
    expect(markdownToPlainText("&#42;&#42;kept&#42;&#42; &#35; too")).toBe(
      "**kept** # too"
    );
  });

  test("leaves unknown names and entities inside code as written", () => {
    expect(markdownToPlainText("&bogus; and `&lt;tag&gt;`")).toBe(
      "&bogus; and &lt;tag&gt;"
    );
  });

  test("never shows half an entity the length cut splits", () => {
    const preview = markdownToPlainText(`${"&lt;".repeat(20)}x`, {
      maxLength: 5,
    });
    expect(preview).toBe("<<<<<");
  });
});

// Bug 17: the words typed around a URL were saved but never shown.
test("never ends a preview on half of an emoji", () => {
  expect(markdownToPlainText("&#128512;", { maxLength: 1 })).toBe("");
  expect(markdownToPlainText("a&#128512;", { maxLength: 2 })).toBe("a");
  expect(markdownToPlainText("&#128512;", { maxLength: 2 })).toBe("😀");
});

describe("linkNoteText", () => {
  test.each([
    ["Read this https://x.com/a later", "Read this later"],
    ["See (https://x.com/a).", "See."],
    ["Check this: https://example.com.", "Check this."],
    ["https://x.com/a great thread on teak", "great thread on teak"],
    [
      "Read https://en.wikipedia.org/wiki/Tectona\\_grandis?a=1&amp;b=2 &amp; enjoy",
      "Read & enjoy",
    ],
    ["**Must** read https://x.com/a", "Must read"],
  ])("shows the words of %p without the URL", (content, expected) => {
    expect(linkNoteText(content)).toBe(expected);
  });

  test.each([
    ["", "no note"],
    ["https://x.com/a", "only the URL"],
    ["  https://x.com/a.  ", "the URL and a period"],
    ["[https://x.com/a](https://x.com/a)", "a self link"],
    ["(https://x.com/a)", "the URL in brackets"],
  ])("shows nothing for %p (%s)", (content) => {
    expect(linkNoteText(content)).toBeUndefined();
  });

  test("shows nothing when the note repeats the link's title", () => {
    expect(
      linkNoteText("Teak - Wikipedia", { title: "Teak - Wikipedia" })
    ).toBeUndefined();
    expect(
      linkNoteText("teak  -  wikipedia", { title: "Teak - Wikipedia" })
    ).toBeUndefined();
    expect(linkNoteText("Teak for decks", { title: "Teak - Wikipedia" })).toBe(
      "Teak for decks"
    );
  });

  test("keeps a short note that only appears inside the title", () => {
    expect(linkNoteText("work", { title: "Network effects" })).toBe("work");
    expect(linkNoteText("Teak", { title: "Teak - Wikipedia" })).toBe("Teak");
  });
});
