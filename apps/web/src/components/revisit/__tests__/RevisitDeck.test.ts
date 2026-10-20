import { describe, expect, test } from "bun:test";
import { revisitKeyAction } from "../RevisitDeck";

const press = (key: string, options: Partial<KeyboardEventInit> = {}) =>
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
