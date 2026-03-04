import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const toastLoading = mock();
const toastSuccess = mock();
const toastError = mock();

mock.module("sonner", () => ({
  toast: {
    loading: toastLoading,
    success: toastSuccess,
    error: toastError,
  },
}));

const { copyCardContentToClipboard } = await import("../useCardClipboard");

const originalNavigator = globalThis.navigator;
const originalConsoleError = console.error;

function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText,
      },
    },
  });
}

describe("copyCardContentToClipboard", () => {
  beforeEach(() => {
    toastLoading.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    console.error = mock(() => {});
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    console.error = originalConsoleError;
  });

  test("copies text content successfully", async () => {
    const writeText = mock(async (_text: string) => {});
    setClipboard(writeText);

    await copyCardContentToClipboard("hello", false);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");
  });

  test("falls back to writeText retry and reports link copy", async () => {
    const writeText = mock(async (_text: string) => {
      if (writeText.mock.calls.length === 1) {
        throw new Error("first attempt failed");
      }
    });
    setClipboard(writeText);

    await copyCardContentToClipboard("https://example.com", false);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied to clipboard", {
      id: "copy-image",
    });
  });

  test("shows error when fallback copy also fails", async () => {
    const writeText = mock(async (_text: string) => {
      throw new Error("always fails");
    });
    setClipboard(writeText);

    await copyCardContentToClipboard("content", false);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith("Failed to copy to clipboard", {
      id: "copy-image",
    });
  });
});
