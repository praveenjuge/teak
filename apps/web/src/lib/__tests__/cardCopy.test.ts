import { describe, expect, mock, test } from "bun:test";
import { cardCopyKind, cardCopyText, resolveImageCopyUrl } from "../cardCopy";

describe("what a card copies", () => {
  test.each([
    [{ type: "image", fileMetadata: { mimeType: "image/png" } }, "image"],
    [
      {
        type: "image",
        fileMetadata: { mimeType: "image/png" },
        url: "https://a.com/p",
      },
      "image",
    ],
    [{ type: "image", fileMetadata: { mimeType: "image/svg+xml" } }, null],
    [
      {
        type: "image",
        fileMetadata: { mimeType: "image/svg+xml" },
        url: "https://a.com/logo.svg",
      },
      "link",
    ],
    [{ type: "link", url: "https://a.com" }, "link"],
    [{ type: "document", url: "https://arxiv.org/pdf/1" }, "link"],
    [{ type: "text", content: "Note" }, "text"],
    [{ type: "quote", content: "Be curious." }, "text"],
    [{ type: "palette" }, null],
    [{ type: "text", content: "Note", isDeleted: true }, null],
  ])("%o copies %p", (card, kind) => {
    expect(cardCopyKind(card)).toBe(kind);
  });

  test("a note copies its card links as titles, and the text being edited", () => {
    const note = { content: "Old", type: "text" };
    expect(cardCopyText(note)).toBe("Old");
    expect(
      cardCopyText(note, "See [[Reading list|teak:k17abc123def456gh]]")
    ).toBe("See Reading list");
  });

  test("a link copies its address, and an image no text", () => {
    expect(cardCopyText({ type: "link", url: "https://a.com/x" })).toBe(
      "https://a.com/x"
    );
    expect(
      cardCopyText({ type: "image", fileMetadata: { mimeType: "image/png" } })
    ).toBe("");
  });
});

describe("resolveImageCopyUrl", () => {
  test("mints the original image URL only when copying", async () => {
    const refresh = mock().mockResolvedValue({
      url: "https://files.teakvault.com/original.jpg",
    });
    await expect(
      resolveImageCopyUrl({
        cardId: "card_123",
        fallbackUrl: "https://files.teakvault.com/grid.jpg",
        fileKey: "original-key",
        refresh,
      })
    ).resolves.toBe("https://files.teakvault.com/original.jpg");
    expect(refresh).toHaveBeenCalledWith({
      cardId: "card_123",
      key: "original-key",
    });
  });

  test("does not substitute a preview if refreshing the original URL fails", async () => {
    await expect(
      resolveImageCopyUrl({
        cardId: "card_123",
        fallbackUrl: "https://files.teakvault.com/grid.jpg",
        fileKey: "original-key",
        refresh: mock().mockRejectedValue(new Error("refresh failed")),
      })
    ).rejects.toThrow("refresh failed");
  });
});
