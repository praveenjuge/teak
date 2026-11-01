import { describe, expect, test } from "bun:test";
import { createTeakTranslator, englishMessages } from "@teak/i18n";
import {
  getPopupStatus,
  type PopupStatusInput,
  previewItem,
  type SavedItem,
  toContextMenuStatus,
} from "../../lib/popupStatus";

const t = createTeakTranslator("en", englishMessages, "extension.popup.status");

const IDLE: PopupStatusInput = {
  autoSave: { state: "idle" },
  fileUpload: { state: "idle" },
};

const status = (input: Partial<PopupStatusInput>) =>
  getPopupStatus({ ...IDLE, ...input }, t);

describe("getPopupStatus", () => {
  test("stays open once someone starts adding tags or a note", () => {
    const saved = {
      autoSave: { state: "success" as const, url: "https://example.com" },
    };
    expect(status(saved)?.autoClose).toBe(true);
    expect(status({ ...saved, detailsTouched: true })).toMatchObject({
      autoClose: false,
      title: "Saved to Teak",
    });
  });

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

  test("shows a picked file already in the library as already saved", () => {
    expect(
      status({ fileUpload: { fileName: "notes.pdf", state: "duplicate" } })
    ).toEqual({
      autoClose: false,
      detail: "notes.pdf",
      title: "Already in your Teak",
      tone: "existing",
    });
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
    {
      autoSave: {
        code: "CARD_LIMIT_REACHED",
        error: "Card limit reached. Please upgrade to Pro for unlimited cards.",
        state: "error",
      },
    },
    {
      contextMenu: {
        code: "CARD_LIMIT_REACHED",
        error: "Card limit reached.",
        status: "error",
      },
    },
    {
      fileUpload: {
        code: "CARD_LIMIT_REACHED",
        error: "Card limit reached.",
        state: "error",
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

describe("previewItem", () => {
  const page = {
    state: "success" as const,
    tab: { favIconUrl: "https://example.com/icon.png", title: "Example" },
    url: "https://example.com/article",
  };
  const file: SavedItem = {
    kind: "file",
    mimeType: "application/pdf",
    name: "Manual.pdf",
    size: 3_500_000,
  };
  const preview = (input: Partial<Parameters<typeof previewItem>[0]>) =>
    previewItem({
      autoSave: page,
      fileState: "idle",
      isRecentSave: false,
      status: { autoClose: true, title: "Saved to Teak", tone: "success" },
      ...input,
    });

  test("previews the current page with its tab's title and icon", () => {
    expect(preview({})).toEqual({
      favIconUrl: "https://example.com/icon.png",
      kind: "page",
      title: "Example",
      url: "https://example.com/article",
    });
    expect(preview({ autoSave: { ...page, state: "loading" } })).toMatchObject({
      kind: "page",
    });
  });

  test("previews the chosen file instead while it uploads", () => {
    expect(preview({ chosenFile: file, fileState: "saving" })).toBe(file);
  });

  test("shows errors, prompts and context-menu saves on their own", () => {
    expect(
      preview({ status: { autoClose: false, title: "x", tone: "error" } })
    ).toBeUndefined();
    expect(
      preview({ status: { autoClose: false, title: "x", tone: "upgrade" } })
    ).toBeUndefined();
    expect(
      preview({
        autoSave: { state: "invalid-url", url: "chrome://extensions" },
      })
    ).toBeUndefined();
    expect(preview({ isRecentSave: true })).toBeUndefined();
  });
});
