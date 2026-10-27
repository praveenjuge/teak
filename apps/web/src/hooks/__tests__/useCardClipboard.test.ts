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
const originalFetch = globalThis.fetch;
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
    console.error = mock(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
  });

  test("copies text content successfully", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    setClipboard(writeText);

    await copyCardContentToClipboard("hello", false);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");
  });

  test("falls back to writeText retry and reports link copy", async () => {
    const writeText = mock((_text: string) => {
      if (writeText.mock.calls.length === 1) {
        return Promise.reject(new Error("first attempt failed"));
      }
      return Promise.resolve();
    });
    setClipboard(writeText);

    await copyCardContentToClipboard("https://example.com", false);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenCalledWith("Link copied to clipboard", {
      id: "copy-image",
    });
  });

  test("shows error when fallback copy also fails", async () => {
    const writeText = mock((_text: string) =>
      Promise.reject(new Error("always fails"))
    );
    setClipboard(writeText);

    await copyCardContentToClipboard("content", false);

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith("Failed to copy to clipboard", {
      id: "copy-image",
    });
  });

  test("copies the link, not an error page, when the image fails to load", async () => {
    const write = mock((_items: unknown[]) => Promise.resolve());
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write, writeText } },
    });
    Object.assign(globalThis, {
      ClipboardItem: class {
        readonly items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
        }
      },
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("<h1>Not found</h1>", {
          headers: { "Content-Type": "text/html" },
          status: 404,
        })
      )
    ) as unknown as typeof fetch;

    await copyCardContentToClipboard("https://files.test/a.png", true);

    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("https://files.test/a.png");
    expect(toastSuccess).toHaveBeenCalledWith("Link copied to clipboard", {
      id: "copy-image",
    });
  });
});
