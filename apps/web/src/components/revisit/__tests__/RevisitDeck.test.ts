import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}

const { revisitKeyAction } = await import("../RevisitDeck");

const press = (
  key: string,
  options: Partial<KeyboardEventInit> & { target?: EventTarget | null } = {}
) =>
  revisitKeyAction({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    key,
    ...options,
  });

describe("revisitKeyAction", () => {
  test.each([
    ["ArrowLeft", "archive"],
    ["a", "archive"],
    ["A", "archive"],
    ["ArrowRight", "keep"],
    ["k", "keep"],
    [" ", "details"],
    ["z", "undo"],
    ["Z", "undo"],
  ])("%j does %s", (key, action) => {
    expect(press(key)).toBe(action);
  });

  test("a held key acts once: repeats are ignored", () => {
    expect(press("ArrowLeft", { repeat: true })).toBeNull();
    expect(press("ArrowRight", { repeat: true })).toBeNull();
  });

  test("leaves modified keys and other keys to the browser", () => {
    expect(press("z", { metaKey: true })).toBeNull();
    expect(press("a", { ctrlKey: true })).toBeNull();
    expect(press("ArrowLeft", { altKey: true })).toBeNull();
    expect(press("Enter")).toBeNull();
    expect(press("Escape")).toBeNull();
  });
});

describe("revisitKeyAction on a focused control", () => {
  const element = (html: string) => {
    const host = new DOMParser().parseFromString(html, "text/html").body;
    return host.querySelector("[data-target]") ?? host;
  };

  test.each([
    ['<button data-target="">Archive</button>'],
    ['<button><span data-target="">Keep</span></button>'],
    ['<a data-target="" href="/x">Link</a>'],
    ['<div data-target="" role="button" tabindex="0">Close</div>'],
    ['<input data-target="" type="checkbox">'],
  ])(
    "Space presses the focused control %s instead of opening details",
    (html) => {
      expect(press(" ", { target: element(html) })).toBeNull();
    }
  );

  test("Space still opens details when the deck itself has focus", () => {
    expect(
      press(" ", {
        target: element('<div data-target="" tabindex="-1"></div>'),
      })
    ).toBe("details");
  });

  test("the arrow keys still archive and keep from a focused button", () => {
    const button = element('<button data-target="">Archive</button>');
    expect(press("ArrowLeft", { target: button })).toBe("archive");
    expect(press("ArrowRight", { target: button })).toBe("keep");
  });

  test("leaves every key to a field someone is typing in", () => {
    const field = element('<input data-target="" type="text">');
    expect(press(" ", { target: field })).toBeNull();
    expect(press("a", { target: field })).toBeNull();
    expect(press("z", { target: field })).toBeNull();
  });
});
