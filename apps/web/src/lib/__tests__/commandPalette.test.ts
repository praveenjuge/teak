import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000" });

const {
  isCommandPaletteKey,
  paletteCardHost,
  paletteCardHref,
  paletteCardSearchArgs,
  paletteCardTitle,
  paletteSearchAllHref,
  paletteShuffleHref,
  parseSettingsDialogParam,
  shouldOpenPalette,
} = await import("../commandPalette");

afterEach(() => {
  document.body.replaceChildren();
});

type Modifiers = Partial<{
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
}>;

const keyEvent = (
  target: EventTarget | null,
  modifiers: Modifiers,
  key = "k"
) => ({
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  key,
  metaKey: false,
  shiftKey: false,
  target,
  ...modifiers,
});

const mount = (html: string): HTMLElement => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
  return document.querySelector("[data-target]") ?? document.body;
};

describe("isCommandPaletteKey", () => {
  test.each([
    ["Cmd+K on a Mac", true, { metaKey: true }, "k", true],
    [
      "Cmd+Shift+K on a Mac",
      true,
      { metaKey: true, shiftKey: true },
      "K",
      false,
    ],
    ["Ctrl+K on a Mac", true, { ctrlKey: true }, "k", false],
    ["Cmd+Alt+K on a Mac", true, { metaKey: true, altKey: true }, "k", false],
    ["Ctrl+K elsewhere", false, { ctrlKey: true }, "k", true],
    ["Ctrl+K with Caps Lock elsewhere", false, { ctrlKey: true }, "K", true],
    ["Meta+K elsewhere", false, { metaKey: true }, "k", false],
    [
      "Ctrl+Shift+K elsewhere",
      false,
      { ctrlKey: true, shiftKey: true },
      "K",
      false,
    ],
    ["a plain K", false, {}, "k", false],
    ["Ctrl+J", false, { ctrlKey: true }, "j", false],
  ] as const)("%s", (_name, apple, modifiers, key, expected) => {
    expect(
      isCommandPaletteKey(keyEvent(document.body, modifiers, key), apple)
    ).toBe(expected);
  });
});

describe("shouldOpenPalette", () => {
  test.each([
    ["the page", "<main data-target></main>", {}, true],
    ["the search box", "<input data-target />", {}, true],
    ["a textarea", "<textarea data-target></textarea>", {}, true],
    [
      "a text editor",
      "<div contenteditable='true'><p data-target>note</p></div>",
      {},
      false,
    ],
    [
      "a read-only editor",
      "<div contenteditable='false'><p data-target>note</p></div>",
      {},
      true,
    ],
    [
      "an event the editor took",
      "<main data-target></main>",
      { defaultPrevented: true },
      false,
    ],
    ["a key held down", "<main data-target></main>", { repeat: true }, false],
    [
      "an IME composition",
      "<input data-target />",
      { isComposing: true },
      false,
    ],
    [
      "an open menu",
      "<main data-target></main><div role='menu' data-state='open'></div>",
      {},
      false,
    ],
    [
      "an open dialog, such as the card modal",
      "<div role='dialog' data-state='open'><button data-target></button></div>",
      {},
      false,
    ],
    [
      "a closed dialog",
      "<main data-target></main><div role='dialog' data-state='closed'></div>",
      {},
      true,
    ],
    [
      "the shortcuts list",
      "<div role='dialog' data-state='open' data-keyboard-shortcuts-dialog><button data-target></button></div>",
      {},
      true,
    ],
  ] as const)("from %s", (_name, html, modifiers, expected) => {
    const target = mount(html);
    expect(
      shouldOpenPalette(
        keyEvent(target, { ctrlKey: true, ...modifiers }),
        document,
        false
      )
    ).toBe(expected);
  });

  test("not for Shift+Cmd+K", () => {
    const target = mount("<main data-target></main>");
    expect(
      shouldOpenPalette(
        keyEvent(target, { metaKey: true, shiftKey: true }, "K"),
        document,
        true
      )
    ).toBe(false);
  });
});

describe("paletteCardHref", () => {
  test.each([
    ["Everything", "/", "", "/?card=c1"],
    [
      "Everything with a search",
      "/",
      "?q=bauhaus&sort=oldest",
      "/?q=bauhaus&sort=oldest&card=c1",
    ],
    ["Archive", "/archive", "", "/archive?card=c1"],
    [
      "a folder",
      "/f/folder1",
      "?type=link,image",
      "/f/folder1?type=link,image&card=c1",
    ],
    ["a card already open", "/favorites", "?card=c0", "/favorites?card=c1"],
    ["Settings", "/settings", "?dialog=export", "/?card=c1"],
    ["Tags", "/tags", "", "/?card=c1"],
    ["no page", null, "", "/?card=c1"],
  ] as const)("from %s", (_name, pathname, search, expected) => {
    expect(paletteCardHref("c1", pathname, search)).toBe(expected);
  });
});

describe("paletteShuffleHref", () => {
  test.each([
    ["Everything", "/", "", "/?sort=shuffle"],
    [
      "a search, dropping the old seed and card",
      "/",
      "?q=red&sort=shuffle&seed=4&card=c1",
      "/?q=red&sort=shuffle",
    ],
    ["a folder", "/f/folder1", "?sort=oldest", "/f/folder1?sort=shuffle"],
    ["Settings", "/settings", "", "/?sort=shuffle"],
  ] as const)("from %s", (_name, pathname, search, expected) => {
    expect(paletteShuffleHref(pathname, search)).toBe(expected);
  });
});

test.each([
  ["/", "/?q=%23design%20site%3Aa.com"],
  ["/favorites", "/?q=%23design%20site%3Aa.com"],
  ["/settings", "/?q=%23design%20site%3Aa.com"],
  [null, "/?q=%23design%20site%3Aa.com"],
  ["/archive", "/archive?q=%23design%20site%3Aa.com"],
] as const)("Search all from %p opens %p", (pathname, expected) => {
  expect(paletteSearchAllHref("  #design site:a.com ", pathname)).toBe(
    expected
  );
});

test.each([
  ["import", "import"],
  ["export", "export"],
  ["Export", null],
  ["delete-account", null],
  ["", null],
  [null, null],
] as const)("the Settings dialog param %p opens %p", (value, expected) => {
  expect(parseSettingsDialogParam(value)).toBe(expected);
});

test.each([
  ["/", { searchQuery: "red" }],
  ["/favorites", { searchQuery: "red" }],
  ["/trash", { searchQuery: "red" }],
  ["/archive", { searchQuery: "red", showArchivedOnly: true }],
  ["/settings", { searchQuery: "red" }],
] as const)("cards searched from %s", (pathname, expected) => {
  expect(paletteCardSearchArgs(" red ", pathname)).toEqual(expected);
});

describe("paletteCardTitle", () => {
  test.each([
    [
      "a link uses its fetched title",
      {
        type: "link",
        url: "https://a.com/x",
        metadata: { linkPreview: { status: "success", title: "Fetched" } },
      },
      "Fetched",
    ],
    [
      "a link renamed by its owner keeps that name",
      {
        type: "link",
        url: "https://a.com/x",
        metadataTitle: "Mine",
        metadataTitleEdited: true,
        metadata: { linkPreview: { status: "success", title: "Fetched" } },
      },
      "Mine",
    ],
    [
      "a link with no title shows its URL",
      { type: "link", url: "https://a.com/x" },
      "https://a.com/x",
    ],
    [
      "a file shows its name",
      { type: "image", fileMetadata: { fileName: "lily.webp" }, content: "" },
      "lily.webp",
    ],
    [
      "a note shows its first line as text",
      { type: "text", content: "## Plans\nsecond line" },
      "Plans",
    ],
    ["an empty note", { type: "text", content: "   " }, "Untitled card"],
  ] as const)("%s", (_name, card, expected) => {
    expect(paletteCardTitle({ _id: "c1", ...card })).toBe(expected);
  });

  test("a 300-character title is not cut mid-row by the data", () => {
    const long = "é".repeat(400);
    expect(
      paletteCardTitle({ _id: "c1", type: "text", content: long })
    ).toHaveLength(300);
  });
});

test.each([
  [{ type: "link", url: "https://www.example.com/a" }, "example.com"],
  [{ type: "link", urlHost: "news.example.org" }, "news.example.org"],
  [{ type: "link", url: "javascript:alert(1)" }, undefined],
  [{ type: "text", url: "https://example.com" }, undefined],
] as const)("the host of %p is %p", (card, expected) => {
  expect(paletteCardHost({ _id: "c1", ...card })).toBe(expected);
});
