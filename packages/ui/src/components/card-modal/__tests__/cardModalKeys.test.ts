import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
afterAll(() => {
  document.body.innerHTML = "";
});

const { canLeaveWithoutSaving, cardModalKeyAction } = await import(
  "../cardModalKeys"
);

const press = (
  key: string,
  target: Element,
  extra: Record<string, boolean> = {}
) =>
  cardModalKeyAction({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    target,
    ...extra,
  });

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
    ["Delete", "delete"],
  ])("%s does %s", (key, action) => {
    expect(press(key, plain)).toBe(action as never);
  });

  test("leaves other keys alone", () => {
    expect(press("x", plain)).toBeNull();
    expect(press("Backspace", plain)).toBeNull();
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

describe("canLeaveWithoutSaving", () => {
  test("leaves at once with nothing to save", () => {
    expect(
      canLeaveWithoutSaving({ hasUnsavedChanges: false, saveState: "idle" })
    ).toBe(true);
  });

  test("saves first while an edit is pending", () => {
    for (const saveState of ["unsaved", "saving", "saved", "idle"]) {
      expect(
        canLeaveWithoutSaving({ hasUnsavedChanges: true, saveState })
      ).toBe(false);
    }
  });

  test("lets a second try leave after a save failed, so no error traps the dialog", () => {
    expect(
      canLeaveWithoutSaving({ hasUnsavedChanges: true, saveState: "error" })
    ).toBe(true);
  });
});
