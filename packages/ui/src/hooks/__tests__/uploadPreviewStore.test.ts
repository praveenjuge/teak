import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllUploadPreviews,
  clearUploadPreview,
  getUploadPreview,
  setUploadPreview,
  subscribeUploadPreviews,
} from "../uploadPreviewStore";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalWindow = globalThis.window;

const createdUrls: string[] = [];
const revokedUrls: string[] = [];

beforeEach(() => {
  // The store gates on `window` for SSR safety; tests run in a DOM-less Bun
  // environment, so expose a minimal window to exercise the registry.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  createdUrls.length = 0;
  revokedUrls.length = 0;
  URL.createObjectURL = (() => {
    const url = `blob:mock-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  clearAllUploadPreviews();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  if (originalWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window;
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

describe("uploadPreviewStore", () => {
  test("stores and returns a preview URL for a card", () => {
    const url = URL.createObjectURL(new Blob());
    setUploadPreview("card_1", url);

    expect(getUploadPreview("card_1")).toBe(url);
  });

  test("clearing a card revokes its object URL", () => {
    const url = URL.createObjectURL(new Blob());
    setUploadPreview("card_1", url);

    clearUploadPreview("card_1");

    expect(getUploadPreview("card_1")).toBeUndefined();
    expect(revokedUrls).toContain(url);
  });

  test("notifies subscribers on changes", () => {
    let notified = 0;
    const unsubscribe = subscribeUploadPreviews(() => {
      notified += 1;
    });

    setUploadPreview("card_1", URL.createObjectURL(new Blob()));
    clearUploadPreview("card_1");

    expect(notified).toBe(2);
    unsubscribe();
  });
});
