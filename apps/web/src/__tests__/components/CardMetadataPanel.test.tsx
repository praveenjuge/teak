import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CardMetadataPanel } from "@teak/ui/card-modal";
import { renderToStaticMarkup } from "react-dom/server";

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

function createMockCard(overrides?: Record<string, unknown>) {
  return {
    _id: "card_123",
    _creationTime: Date.now(),
    content: "Color study",
    createdAt: Date.now(),
    isDeleted: false,
    isFavorited: false,
    tags: ["moodboard", "branding"],
    type: "image",
    updatedAt: Date.now(),
    userId: "user_123",
    ...overrides,
  };
}

describe("CardMetadataPanel", () => {
  beforeEach(() => {
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

  test("renders normalized palette badges between tags and AI tags", () => {
    const markup = renderToStaticMarkup(
      <CardMetadataPanel
        actions={{
          deleteCard: () => {},
          permanentlyDeleteCard: () => {},
          restoreCard: () => {},
          showMoreInfo: () => {},
          showNotesEditor: () => {},
          showTagManager: () => {},
          toggleFavorite: () => {},
        }}
        card={
          createMockCard({
            aiTags: ["curated"],
            colors: [
              { hex: "112233" },
              { hex: "#445566" },
              { hex: "not-a-color" },
              { hex: "#112233" },
            ],
          }) as any
        }
        getCurrentValue={() => undefined}
        onCardTypeClick={() => {}}
        onTagClick={() => {}}
      />
    );

    expect(markup).toContain(">#112233<");
    expect(markup).toContain(">#445566<");
    expect(markup).not.toContain(">not-a-color<");
    expect((markup.match(/>#112233</g) ?? []).length).toBe(1);
    expect(markup).toContain("overflow-visible");

    const typeIndex = markup.indexOf(">Image<");
    const tagIndex = markup.indexOf(">branding<");
    const paletteIndex = markup.indexOf(">#112233<");
    const aiTagIndex = markup.indexOf(">curated<");

    expect(typeIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(typeIndex);
    expect(paletteIndex).toBeGreaterThan(tagIndex);
    expect(aiTagIndex).toBeGreaterThan(paletteIndex);
  });

  test("copies palette hex values to the clipboard", async () => {
    const writeText = mock(async (_text: string) => {});
    setClipboard(writeText);

    await copyColorHexToClipboard("#112233");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("#112233");
    expect(toastSuccess).toHaveBeenCalledWith("Copied #112233");
  });

  test("shows an error toast when palette copy fails", async () => {
    const writeText = mock(async (_text: string) => {
      throw new Error("clipboard failed");
    });
    setClipboard(writeText);

    await copyColorHexToClipboard("#112233");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Failed to copy");
  });
});
