import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
afterAll(() => {
  document.body.innerHTML = "";
});

const { cardModalKeyAction } = await import("../cardModalKeys");

const press = (
  key: string,
  target: Element,
  extra: Record<string, boolean> = {},
  apple = false
) =>
  cardModalKeyAction(
    {
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      shiftKey: false,
      target,
      ...extra,
    },
    apple
  );

describe("cardModalKeyAction", () => {
  const plain = document.createElement("div");
  document.body.append(plain);

  test.each([
    ["ArrowLeft", "previous"],
    ["ArrowRight", "next"],
    ["k", "previous"],
    ["j", "next"],
    ["f", "favorite"],
    ["F", "favorite"],
    ["e", "archive"],
    ["t", "focusTags"],
    ["n", "focusNotes"],
    ["d", "done"],
    ["o", "open"],
    ["c", "copy"],
    ["i", "toggleDetails"],
    ["r", "toggleReader"],
    ["h", "highlight"],
    ["H", "highlight"],
    ["Delete", "delete"],
  ])("%s does %s", (key, action) => {
    expect(press(key, plain)).toBe(action as never);
  });

  test("Backspace deletes only on a Mac, where it is the Delete key", () => {
    expect(press("Backspace", plain, {}, true)).toBe("delete");
    expect(press("Backspace", plain, {}, false)).toBeNull();
  });

  test("leaves other keys alone", () => {
    expect(press("x", plain)).toBeNull();
    expect(press("Escape", plain)).toBeNull();
  });

  test("never fires while someone types", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editor.append(inside);
    document.body.append(input, textarea, editor);
    expect(press("f", input)).toBeNull();
    expect(press("ArrowRight", textarea)).toBeNull();
    expect(press("n", inside)).toBeNull();
  });

  test("Mod+Enter opens the card, but saves in a field", () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    expect(press("Enter", plain, { metaKey: true }, true)).toBe("open");
    expect(press("Enter", plain, { ctrlKey: true }, false)).toBe("open");
    expect(press("Enter", plain, { ctrlKey: true }, true)).toBeNull();
    expect(press("Enter", plain)).toBeNull();
    expect(press("Enter", input, { metaKey: true }, true)).toBeNull();
  });

  test("lets a focused player keep its arrow keys", () => {
    const video = document.createElement("video");
    document.body.append(video);
    expect(press("ArrowLeft", video)).toBeNull();
  });

  test("ignores modified keys and held letters, but not held arrows", () => {
    expect(press("f", plain, { metaKey: true })).toBeNull();
    expect(press("ArrowRight", plain, { shiftKey: true })).toBeNull();
    expect(press("f", plain, { repeat: true })).toBeNull();
    expect(press("ArrowRight", plain, { repeat: true })).toBe("next");
  });
});
