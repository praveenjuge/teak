// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { shouldAutoClosePopup } from "../../lib/popupAutoClose";

describe("shouldAutoClosePopup", () => {
  test("closes after ordinary and context-menu saves while file upload is idle", () => {
    expect(
      shouldAutoClosePopup({
        fileUploadState: "idle",
        isAutoSaveSuccess: true,
        isContextMenuSuccess: false,
      })
    ).toBe(true);
    expect(
      shouldAutoClosePopup({
        fileUploadState: "idle",
        isAutoSaveSuccess: false,
        isContextMenuSuccess: true,
      })
    ).toBe(true);
  });

  test("keeps the popup open while a selected file is saving or has failed", () => {
    for (const fileUploadState of ["saving", "error"] as const) {
      expect(
        shouldAutoClosePopup({
          fileUploadState,
          isAutoSaveSuccess: true,
          isContextMenuSuccess: true,
        })
      ).toBe(false);
    }
  });

  test("closes only after the selected file finishes saving", () => {
    expect(
      shouldAutoClosePopup({
        fileUploadState: "success",
        isAutoSaveSuccess: false,
        isContextMenuSuccess: false,
      })
    ).toBe(true);
  });
});
