import { describe, expect, mock, test } from "bun:test";
import { importIncomingShareItems } from "../../lib/share/importIncomingShare";
import type { NormalizedShareItem } from "../../lib/share/types";

function createTextItem(id: string, content = "hello"): NormalizedShareItem {
  return {
    id,
    source: "raw",
    kind: "text",
    content,
  };
}

function createFileItem(
  id: string,
  size: number | null = null
): NormalizedShareItem {
  return {
    id,
    source: "raw",
    kind: "file",
    content: "shared-file.jpg",
    fileName: "shared-file.jpg",
    fileUri: "file:///tmp/shared-file.jpg",
    fileSize: size,
    mimeType: "image/jpeg",
  };
}

describe("importIncomingShareItems", () => {
  test("imports all items successfully", async () => {
    const createCard = mock(async () => "card_text");
    const uploadFileFromUri = mock(async () => ({
      success: true as const,
      cardId: "card_file",
    }));

    const result = await importIncomingShareItems(
      [createTextItem("item-1"), createFileItem("item-2")],
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.successfulItems).toBe(2);
    expect(result.failedItems).toBe(0);
    expect(result.createdCardIds).toEqual(["card_text", "card_file"]);
  });

  test("returns partial result when one item fails", async () => {
    const createCard = mock(async () => {
      throw new Error("create failed");
    });
    const uploadFileFromUri = mock(async () => ({
      success: true as const,
      cardId: "card_file",
    }));

    const result = await importIncomingShareItems(
      [createTextItem("item-1"), createFileItem("item-2")],
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.successfulItems).toBe(1);
    expect(result.failedItems).toBe(1);
    expect(result.failures[0]?.reason).toBe("CREATE_FAILED");
  });

  test("enforces maximum of five items", async () => {
    const items: NormalizedShareItem[] = [
      createTextItem("1"),
      createTextItem("2"),
      createTextItem("3"),
      createTextItem("4"),
      createTextItem("5"),
      createTextItem("6"),
    ];

    const createCard = mock(async () => "card");
    const uploadFileFromUri = mock(async () => ({
      success: true as const,
      cardId: "unused",
    }));

    const result = await importIncomingShareItems(
      items,
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.attemptedItems).toBe(5);
    expect(result.failedItems).toBe(1);
    expect(result.failures[0]?.reason).toBe("TOO_MANY_ITEMS");
  });

  test("returns unauthenticated failures when user is signed out", async () => {
    const createCard = mock(async () => "card");
    const uploadFileFromUri = mock(async () => ({
      success: true as const,
      cardId: "card",
    }));

    const result = await importIncomingShareItems(
      [createTextItem("item-1"), createFileItem("item-2")],
      { createCard, uploadFileFromUri },
      { isAuthenticated: false }
    );

    expect(result.successfulItems).toBe(0);
    expect(result.failedItems).toBe(2);
    expect(
      result.failures.every((failure) => failure.reason === "UNAUTHENTICATED")
    ).toBe(true);
  });

  test("fails file item that exceeds max size", async () => {
    const createCard = mock(async () => "card");
    const uploadFileFromUri = mock(async () => ({
      success: true as const,
      cardId: "card",
    }));

    const result = await importIncomingShareItems(
      [createFileItem("item-1", 25 * 1024 * 1024)],
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.successfulItems).toBe(0);
    expect(result.failedItems).toBe(1);
    expect(result.failures[0]?.reason).toBe("FILE_TOO_LARGE");
  });

  test("captures upload failures from upload dependency", async () => {
    const createCard = mock(async () => "card");
    const uploadFileFromUri = mock(async () => ({
      success: false as const,
      error: "upload failed",
    }));

    const result = await importIncomingShareItems(
      [createFileItem("item-1")],
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.successfulItems).toBe(0);
    expect(result.failedItems).toBe(1);
    expect(result.failures[0]?.reason).toBe("UPLOAD_FAILED");
  });

  test("captures thrown upload dependency errors as upload failures", async () => {
    const createCard = mock(async () => "card");
    const uploadFileFromUri = mock(async () => {
      throw new Error("network timeout");
    });

    const result = await importIncomingShareItems(
      [createFileItem("item-1")],
      { createCard, uploadFileFromUri },
      { isAuthenticated: true }
    );

    expect(result.successfulItems).toBe(0);
    expect(result.failedItems).toBe(1);
    expect(result.failures[0]?.reason).toBe("UPLOAD_FAILED");
    expect(result.failures[0]?.message).toBe("network timeout");
  });
});
