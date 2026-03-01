import { describe, expect, test } from "bun:test";
import {
  createIncomingShareSignature,
  getPostImportStatus,
  getPreImportStatus,
} from "../../lib/share/incomingShareFlow";
import type { NormalizedShareItem } from "../../lib/share/types";

function createTextItem(id: string, content: string): NormalizedShareItem {
  return {
    id,
    source: "resolved",
    kind: "text",
    content,
  };
}

function createFileItem(
  id: string,
  fileUri: string,
  fileName: string
): NormalizedShareItem {
  return {
    id,
    source: "resolved",
    kind: "file",
    content: fileName,
    fileName,
    fileUri,
    mimeType: "image/jpeg",
  };
}

describe("incoming-share flow helpers", () => {
  test("supports resolving -> saving -> saved transition sequence", () => {
    const resolvingStatus = getPreImportStatus({
      isLoadingAuth: true,
      isResolving: true,
      isAuthenticated: true,
      normalizedItemCount: 1,
      hasResolveError: false,
    });
    const savingStatus = getPreImportStatus({
      isLoadingAuth: false,
      isResolving: false,
      isAuthenticated: true,
      normalizedItemCount: 1,
      hasResolveError: false,
    });
    const savedStatus = getPostImportStatus({
      totalItems: 1,
      attemptedItems: 1,
      successfulItems: 1,
      failedItems: 0,
      failures: [],
      createdCardIds: ["card-1"],
    });

    expect(resolvingStatus).toBe("resolving");
    expect(savingStatus).toBe("saving");
    expect(savedStatus).toBe("saved");
  });

  test("returns error status when import result has no successes", () => {
    const status = getPostImportStatus({
      totalItems: 1,
      attemptedItems: 1,
      successfulItems: 0,
      failedItems: 1,
      failures: [
        {
          itemId: "item-1",
          reason: "CREATE_FAILED",
          message: "failed",
        },
      ],
      createdCardIds: [],
    });

    expect(status).toBe("error");
  });

  test("returns authRequired while signed out with shared payload", () => {
    const status = getPreImportStatus({
      isLoadingAuth: false,
      isResolving: false,
      isAuthenticated: false,
      normalizedItemCount: 1,
      hasResolveError: false,
    });

    expect(status).toBe("authRequired");
  });

  test("produces the same signature for duplicate payloads in session", () => {
    const payloadA = [createTextItem("item-1", "hello world")];
    const payloadB = [createTextItem("item-2", "hello world")];

    const signatureA = createIncomingShareSignature(payloadA);
    const signatureB = createIncomingShareSignature(payloadB);

    expect(signatureA).toBe(signatureB);
  });

  test("keeps file signatures stable across re-materialized payload arrays", () => {
    const payloadA = [
      createFileItem("item-1", "file:///tmp/photo.jpg", "photo.jpg"),
    ];
    const payloadB = [
      createFileItem("item-2", "file:///tmp/photo.jpg", "photo.jpg"),
    ];

    const signatureA = createIncomingShareSignature(payloadA);
    const signatureB = createIncomingShareSignature(payloadB);

    expect(signatureA).toBe(signatureB);
  });
});
