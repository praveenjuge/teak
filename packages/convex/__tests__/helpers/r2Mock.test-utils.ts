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
  resolveObjectUrl: mock().mockResolvedValue(null),
  storeObject: mock().mockResolvedValue("stub-key"),
  generateUploadUrl: mock(),
  syncUploadedObjectMetadata: mock(),
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
  deleteObject: r2Mocks.deleteObject,
  resolveObjectUrl: r2Mocks.resolveObjectUrl,
  storeObject: r2Mocks.storeObject,
  generateUploadUrl: r2Mocks.generateUploadUrl,
  syncUploadedObjectMetadata: r2Mocks.syncUploadedObjectMetadata,
  getFileUrl: r2Mocks.getFileUrl,
  getR2Url: r2Mocks.getR2Url,
  buildR2UserPrefix: r2Mocks.buildR2UserPrefix,
  buildR2ObjectKey: r2Mocks.buildR2ObjectKey,
  r2: r2Mocks.r2,
});
