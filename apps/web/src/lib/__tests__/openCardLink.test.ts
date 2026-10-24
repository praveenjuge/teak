import { describe, expect, test } from "bun:test";
import {
  cardLinkTarget,
  handleCardLinkClick,
  type OpenableCard,
  openCardLink,
} from "../openCardLink";

const APP = "https://app.teakvault.com";
const ARCHIVE = { storageKey: "users/x/cards/c/page-archive/a", kind: "full" };

const link = (fields: Partial<OpenableCard> = {}): OpenableCard => ({
  _id: "k17abc",
  type: "link",
  url: "https://example.com/post",
  ...fields,
});

const recorder = () => {
  const opened: Array<{ features: string; target: string; url: string }> = [];
  return {
    open: (url: string, target: string, features: string) => {
      opened.push({ features, target, url });
    },
    opened,
  };
};

describe("which address a card opens", () => {
  test.each([
    [
      "a link with an archived copy opens the check",
      link({ pageArchive: ARCHIVE }),
      `${APP}/open/k17abc`,
    ],
    ["a link without one opens its page", link(), "https://example.com/post"],
    [
      "a link in Trash opens its page, even with a copy",
      link({ isDeleted: true, pageArchive: ARCHIVE }),
      "https://example.com/post",
    ],
    [
      "a note with a copy somehow still has no check",
      link({ pageArchive: ARCHIVE, type: "text" }),
      "https://example.com/post",
    ],
    [
      "an unsafe address opens nothing, copy or not",
      link({ pageArchive: ARCHIVE, url: "javascript:alert(1)" }),
      null,
    ],
    ["a card with no address opens nothing", link({ url: undefined }), null],
  ])("%s", (_name, card, expected) => {
    expect(cardLinkTarget(card, APP)).toBe(expected);
  });

  test("the card id is escaped in the path", () => {
    expect(
      cardLinkTarget(link({ _id: "a/b?c", pageArchive: ARCHIVE }), APP)
    ).toBe(`${APP}/open/a%2Fb%3Fc`);
  });
});

describe("opening a card's link", () => {
  test("opens the check in a new tab without the opener", () => {
    const { open, opened } = recorder();
    expect(
      openCardLink(link({ pageArchive: ARCHIVE }), { appOrigin: APP, open })
    ).toBe(true);
    expect(opened).toEqual([
      { features: "noopener", target: "_blank", url: `${APP}/open/k17abc` },
    ]);
  });

  test("opens the page itself without the opener or the referrer", () => {
    const { open, opened } = recorder();
    openCardLink(link(), { appOrigin: APP, open });
    expect(opened).toEqual([
      {
        features: "noopener,noreferrer",
        target: "_blank",
        url: "https://example.com/post",
      },
    ]);
  });

  test("opens nothing for an unsafe address", () => {
    const { open, opened } = recorder();
    expect(
      openCardLink(link({ url: "data:text/html,hi" }), { appOrigin: APP, open })
    ).toBe(false);
    expect(opened).toEqual([]);
  });
});

describe("clicking a card's link anchor", () => {
  const click = (
    fields: Partial<Parameters<typeof handleCardLinkClick>[0]>
  ) => {
    const event = {
      altKey: false,
      button: 0,
      defaultPrevented: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      shiftKey: false,
      ...fields,
    };
    return event;
  };

  test.each([
    ["a primary click", {}],
    ["a ⌘-click", { metaKey: true }],
    ["a Ctrl-click", { ctrlKey: true }],
  ])("%s on a link with a copy opens the check instead", (_name, fields) => {
    const { open, opened } = recorder();
    const event = click(fields);
    handleCardLinkClick(event, link({ pageArchive: ARCHIVE }), {
      appOrigin: APP,
      open,
    });
    expect(event.prevented).toBe(true);
    expect(opened.map((entry) => entry.url)).toEqual([`${APP}/open/k17abc`]);
  });

  test.each([
    ["a middle click", { button: 1 }],
    ["a Shift-click", { shiftKey: true }],
    ["an Alt-click", { altKey: true }],
    ["a click something else handled", { defaultPrevented: true }],
  ])("%s is left to the browser and the real address", (_name, fields) => {
    const { open, opened } = recorder();
    const event = click(fields);
    handleCardLinkClick(event, link({ pageArchive: ARCHIVE }), {
      appOrigin: APP,
      open,
    });
    expect(event.prevented).toBe(false);
    expect(opened).toEqual([]);
  });

  test("a click on a link without a copy is left to the anchor", () => {
    const { open, opened } = recorder();
    const event = click({});
    handleCardLinkClick(event, link(), { appOrigin: APP, open });
    expect(event.prevented).toBe(false);
    expect(opened).toEqual([]);
  });
});
