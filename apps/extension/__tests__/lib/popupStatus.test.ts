import { describe, expect, test } from "bun:test";
import {
  getPopupStatus,
  type PopupStatusInput,
  toContextMenuStatus,
} from "../../lib/popupStatus";

const IDLE: PopupStatusInput = {
  autoSave: { state: "idle" },
  fileUpload: { state: "idle" },
};

const status = (input: Partial<PopupStatusInput>) =>
  getPopupStatus({ ...IDLE, ...input });

describe("getPopupStatus", () => {
  test("shows a page already in the library as already saved and stays open", () => {
    expect(
      status({
        autoSave: {
          state: "duplicate",
          url: "https://www.example.com/article",
        },
      })
    ).toEqual({
      autoClose: false,
      detail: "example.com",
      title: "Already in your Teak",
      tone: "existing",
    });
  });

  test("closes after saving the current page and names its site", () => {
    expect(
      status({
        autoSave: { state: "success", url: "https://news.example.org/a?b=1" },
      })
    ).toEqual({
      autoClose: true,
      detail: "news.example.org",
      title: "Saved to Teak",
      tone: "success",
    });
  });

  test("reports a right-click save of something already saved as already saved", () => {
    expect(
      status({
        contextMenu: { action: "save-page", status: "duplicate" },
      })
    ).toMatchObject({
      autoClose: false,
      title: "Already in your Teak",
      tone: "existing",
    });
  });

  test.each([
    ["save-page", "Page saved"],
    ["save-text", "Text saved"],
    ["save-asset", "Saved to Teak"],
  ] as const)("closes after a right-click %s save", (action, title) => {
    expect(
      status({ contextMenu: { action, status: "success" } })
    ).toMatchObject({ autoClose: true, title, tone: "success" });
  });

  test("shows a right-click save in progress over the automatic page save", () => {
    expect(
      status({
        autoSave: { state: "success" },
        contextMenu: { action: "save-text", status: "saving" },
      })
    ).toMatchObject({ autoClose: false, tone: "loading" });
  });

  test("keeps the popup open while a picked file uploads, even if the page saved", () => {
    expect(
      status({
        autoSave: { state: "success" },
        fileUpload: { fileName: "notes.pdf", state: "saving" },
      })
    ).toEqual({
      autoClose: false,
      detail: "notes.pdf",
      title: "Uploading file",
      tone: "loading",
    });
  });

  test("closes only after the picked file finishes uploading", () => {
    expect(
      status({ fileUpload: { fileName: "notes.pdf", state: "success" } })
    ).toMatchObject({ autoClose: true, title: "File saved" });
  });

  test("keeps a failed upload's reason on screen", () => {
    expect(
      status({
        fileUpload: { error: "File is empty or too large.", state: "error" },
      })
    ).toEqual({
      autoClose: false,
      detail: "File is empty or too large.",
      title: "Couldn't upload file",
      tone: "error",
    });
  });

  test.each([
    { autoSave: { error: "CARD_LIMIT_REACHED: limit", state: "error" } },
    {
      contextMenu: {
        error: "CARD_LIMIT_REACHED: limit",
        status: "error",
      },
    },
  ] as Partial<PopupStatusInput>[])(
    "offers an upgrade at the card limit",
    (input) => {
      expect(status(input)).toMatchObject({
        autoClose: false,
        tone: "upgrade",
      });
    }
  );

  test("explains pages that can't be saved", () => {
    expect(
      status({ autoSave: { state: "invalid-url", url: "chrome://extensions" } })
    ).toMatchObject({ title: "Can't save this page", tone: "info" });
  });

  test("shows nothing before the automatic save starts", () => {
    expect(status({})).toBeNull();
  });
});

describe("toContextMenuStatus", () => {
  test.each([
    [{ cardId: "c1", status: "saved" }, "success"],
    [{ status: "duplicate" }, "duplicate"],
    [{ message: "Network error", status: "error" }, "error"],
    [{ status: "unauthenticated" }, "error"],
  ] as const)("maps %o to %s", (result, expected) => {
    expect(toContextMenuStatus(result)).toBe(expected);
  });
});
