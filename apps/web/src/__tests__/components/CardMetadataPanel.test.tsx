import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const toastSuccess = mock();
const toastError = mock();

mock.module("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

const { copyColorHexToClipboard } = await import(
  "../../../../../packages/ui/src/components/card-modal/CardMetadataPanel"
);

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

describe("CardMetadataPanel", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    console.error = mock(() => {
      // noop: silence expected error logs during tests
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    console.error = originalConsoleError;
  });

  test("copies palette hex values to the clipboard", async () => {
    const writeText = mock((_text: string) => Promise.resolve());
    setClipboard(writeText);

    await copyColorHexToClipboard("#112233");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("#112233");
    expect(toastSuccess).toHaveBeenCalledWith("Copied #112233");
  });

  test("shows an error toast when palette copy fails", async () => {
    const writeText = mock((_text: string) =>
      Promise.reject(new Error("clipboard failed"))
    );
    setClipboard(writeText);

    await copyColorHexToClipboard("#112233");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Failed to copy");
  });
});
