// @ts-nocheck
/**
 * Shared R2 storage module mock for tests. Bun's `mock.module` is registered
 * globally, so any test file that mocks `storage/r2` will affect every other
 * test that imports it. This helper provides a single mock that:
 *   - Preserves the real `buildR2UserPrefix` and `buildR2ObjectKey` so callers
 *     that validate or build keys still produce correct values.
 *   - Replaces the side-effecting helpers (`deleteObject`, `resolveObjectUrl`,
 *     `storeObject`) with bun mocks that callers can `mockClear` / configure.
 *
 * Use it like:
 *   import { r2Mocks } from "../helpers/r2Mock.test-utils";
 *   // in a test: r2Mocks.deleteObject.mockResolvedValueOnce(...);
 */

import { mock } from "bun:test";

const hashUserId = (userId: string) =>
  Array.from(new TextEncoder().encode(userId))
    .reduce((hash, byte) => (hash * 31 + byte) >>> 0, 0)
    .toString(36);

const buildR2UserPrefix = (userId: string) =>
  ["users", hashUserId(userId), "cards"].join("/");

const buildR2ObjectKey = ({
  userId,
  cardId,
  role,
  fileName,
}: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
}) => {
  const safeName = fileName?.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return [
    buildR2UserPrefix(userId),
    cardId ?? "pending",
    role,
    `${crypto.randomUUID()}${safeName ? `-${safeName}` : ""}`,
  ].join("/");
};

export const r2Mocks = {
  deleteObject: mock().mockResolvedValue(null),
  resolveImageUrl: mock((key: string) => r2Mocks.resolveObjectUrl(key)),
  resolveObjectUrl: mock().mockResolvedValue(null),
  storeObject: mock().mockResolvedValue("stub-key"),
  generateUploadUrl: mock(),
  getFileUrl: mock(),
  getR2Url: mock().mockResolvedValue(null),
  buildR2UserPrefix,
  buildR2ObjectKey,
  r2: {
    generateUploadUrl: mock(),
    deleteObject: mock().mockResolvedValue(null),
    store: mock().mockResolvedValue("stub-key"),
    getUrl: mock().mockResolvedValue(null),
  },
};

export const r2MockModuleFactory = () => ({
  // Faithful port of the real cardStorageObjectKeys so tests that receive the
  // mocked module still observe identical key collection semantics.
  cardStorageObjectKeys: (card: {
    fileKey?: string;
    thumbnailKey?: string;
    previewKey?: string;
    metadata?: {
      linkPreview?: {
        imageStorageKey?: string;
        media?: Array<{ posterStorageKey?: string; storageKey?: string }>;
        screenshotStorageKey?: string;
      };
    };
  }): string[] => {
    const linkPreview = card.metadata?.linkPreview;
    return [
      card.fileKey,
      card.fileKey ? `${card.fileKey}.processing.json` : undefined,
      card.thumbnailKey,
      card.previewKey,
      linkPreview?.imageStorageKey,
      linkPreview?.screenshotStorageKey,
      ...(linkPreview?.media ?? []).flatMap((item) => [
        item.storageKey,
        item.posterStorageKey,
      ]),
    ].filter((key, index, keys): key is string =>
      Boolean(key && keys.indexOf(key) === index)
    );
  },
  deleteObject: r2Mocks.deleteObject,
  // Real HMAC helper: filesWorkerClient signs op payloads through this export,
  // so keep it available even when the rest of the module is mocked.
  hmacSha256Hex: async (secret: string, message: string): Promise<string> => {
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(message).digest("hex");
  },
  resolveImageUrl: r2Mocks.resolveImageUrl,
  resolveObjectUrl: r2Mocks.resolveObjectUrl,
  storeObject: r2Mocks.storeObject,
  generateUploadUrl: r2Mocks.generateUploadUrl,
  getFileUrl: r2Mocks.getFileUrl,
  getR2Url: r2Mocks.getR2Url,
  buildR2UserPrefix: r2Mocks.buildR2UserPrefix,
  buildR2ObjectKey: r2Mocks.buildR2ObjectKey,
  r2: r2Mocks.r2,
});
