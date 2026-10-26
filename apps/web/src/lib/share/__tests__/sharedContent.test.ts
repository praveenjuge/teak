import { describe, expect, test } from "bun:test";
import {
  readSharedText,
  SHARE_TEXT_LIMIT,
  sharedDraft,
  shareLibraryPath,
  withoutShareParams,
} from "../sharedContent";

describe("sharedDraft", () => {
  test("a shared page is its link alone", () => {
    expect(
      sharedDraft({ title: "Example", url: "https://example.com/a" })
    ).toBe("https://example.com/a");
  });

  test("a link shared as text is that link", () => {
    expect(sharedDraft({ text: " https://example.com/b " })).toBe(
      "https://example.com/b"
    );
    expect(
      sharedDraft({
        text: "https://example.com/c",
        url: "https://example.com/c",
      })
    ).toBe("https://example.com/c");
  });

  test("text keeps the title above it and the link below, never twice", () => {
    expect(
      sharedDraft({
        title: "Field notes",
        text: "A quote worth keeping",
        url: "https://example.com/d",
      })
    ).toBe("Field notes\nA quote worth keeping\nhttps://example.com/d");
    expect(
      sharedDraft({
        text: "Read this https://example.com/e",
        url: "https://example.com/e",
      })
    ).toBe("Read this https://example.com/e");
    expect(sharedDraft({ title: "Notes", text: "Notes from today" })).toBe(
      "Notes from today"
    );
  });
});

describe("shareLibraryPath", () => {
  test("opens the composer with the text and any kept files", () => {
    expect(
      shareLibraryPath(
        { title: " T ", text: "", url: "https://example.com" },
        "123-x"
      )
    ).toBe("/?compose=1&title=T&url=https%3A%2F%2Fexample.com&share=123-x");
  });

  test("cuts very long text so the URL stays usable", () => {
    const path = shareLibraryPath({ text: "a".repeat(SHARE_TEXT_LIMIT + 50) });
    expect(new URLSearchParams(path.slice(2)).get("text")).toHaveLength(
      SHARE_TEXT_LIMIT
    );
  });
});

describe("the library URL", () => {
  test("reads a share's text fields, or nothing", () => {
    expect(
      readSharedText(new URLSearchParams("compose=1&text=hi&url=https://a.b"))
    ).toEqual({ text: "hi", url: "https://a.b" });
    expect(readSharedText(new URLSearchParams("compose=1&q=x"))).toBeNull();
  });

  test("drops a share's parameters and keeps the rest", () => {
    expect(
      withoutShareParams("?compose=1&title=t&text=x&url=u&share=1-a&q=design")
    ).toBe("compose=1&q=design");
  });
});
