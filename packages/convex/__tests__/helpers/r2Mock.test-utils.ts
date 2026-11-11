// Bun's `mock.module` is registered globally, so a test file that mocks
// `storage/r2` or `storage/objectDeletion` affects every other test that
// imports it.

import { mock } from "bun:test";
import { buildCardObjectKey, filesCardKeyPrefix } from "@teak/files-protocol";
import { cardStorageObjectKeys } from "../../storage/cardObjectKeys";
import { PENDING_UPLOAD_CARD_ID } from "../../storage/r2";

const buildR2UserPrefix = (userId: string) => filesCardKeyPrefix("", userId);

const buildR2ObjectKey = (args: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
}) => buildCardObjectKey({ envPrefix: "", ...args });

export const r2Mocks = {
  queueObjectDeletion: mock().mockResolvedValue(null),
  resolveImageUrl: mock((key: string) => r2Mocks.resolveObjectUrl(key)),
  resolveObjectUrl: mock().mockResolvedValue(null),
  getR2Url: mock().mockResolvedValue(null),
  buildR2UserPrefix,
  buildR2ObjectKey,
  r2: {
    generateUploadUrl: mock(),
    queueObjectDeletion: mock().mockResolvedValue(null),
    store: mock().mockResolvedValue("stub-key"),
    getUrl: mock().mockResolvedValue(null),
  },
};

/** Every object key queued for deletion, however the keys were batched. */
export const queuedDeletionKeys = (): string[] =>
  r2Mocks.queueObjectDeletion.mock.calls
    .flatMap((call: unknown[]) => call[1] as string | (string | undefined)[])
    .filter((key): key is string => Boolean(key));

export const r2MockModuleFactory = () => ({
  PENDING_UPLOAD_CARD_ID,
  cardStorageObjectKeys,
  buildR2UserPrefix: r2Mocks.buildR2UserPrefix,
  buildR2ObjectKey: r2Mocks.buildR2ObjectKey,
  r2: r2Mocks.r2,
});

export const objectDeletionMockModuleFactory = () => ({
  enqueue: mock(),
  objectDeletionDispatch: { delivery: "delete-objects" },
  queueObjectDeletion: r2Mocks.queueObjectDeletion,
});
