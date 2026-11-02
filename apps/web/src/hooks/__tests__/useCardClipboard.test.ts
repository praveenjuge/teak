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
    // Like a browser, the clipboard waits for each item's data.
    const write = mock((items: { items: Record<string, unknown> }[]) =>
      Promise.all(items.flatMap((item) => Object.values(item.items))).then(
        () => undefined
      )
    );
    const writeText = mock((_text: string) => Promise.resolve());
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write, writeText } },
    });
    Object.assign(globalThis, {
      ClipboardItem: class {
        readonly items: Record<string, unknown>;
        constructor(items: Record<string, unknown>) {
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

    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("https://files.test/a.png");
    expect(toastSuccess).toHaveBeenCalledWith("Link copied to clipboard", {
      id: "copy-image",
    });
  });

  test("starts the clipboard write before anything is awaited, as Safari needs", async () => {
    const order: string[] = [];
    let releaseUrl: (url: string) => void = () => undefined;
    const url = new Promise<string>((resolve) => {
      releaseUrl = resolve;
    });
    const write = mock((items: { items: Record<string, unknown> }[]) => {
      order.push("write");
      return Promise.all(
        items.flatMap((item) => Object.values(item.items))
      ).then(() => undefined);
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { write, writeText: mock() } },
    });
    Object.assign(globalThis, {
      ClipboardItem: class {
        readonly items: Record<string, unknown>;
        constructor(items: Record<string, unknown>) {
          this.items = items;
        }
      },
    });
    const png = new Blob(["png"], { type: "image/png" });
    globalThis.fetch = mock(() => {
      order.push("fetch");
      return Promise.resolve(new Response(png));
    }) as unknown as typeof fetch;

    const copying = copyCardContentToClipboard(url, true);
    // Synchronously, within the gesture: the write has begun, the fetch not.
    expect(order).toEqual(["write"]);
    releaseUrl("https://files.test/a.png");
    await copying;

    expect(order).toEqual(["write", "fetch"]);
    const [[[item]]] = write.mock.calls as unknown as [
      [{ items: Record<string, Promise<Blob>> }[]],
    ][];
    expect(Object.keys(item.items)).toEqual(["image/png"]);
    const copied = await item.items["image/png"];
    expect(copied.type).toBe("image/png");
    expect(await copied.text()).toBe("png");
    expect(toastSuccess).toHaveBeenCalledWith("Image copied to clipboard", {
      id: "copy-image",
    });
  });
});
