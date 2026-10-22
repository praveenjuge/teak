// Bun's `mock.module` is registered globally, so a test file that mocks
// `storage/r2` affects every other test that imports it.

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

export const r2MockModuleFactory = () => ({
  PENDING_UPLOAD_CARD_ID,
  cardStorageObjectKeys,
  queueObjectDeletion: r2Mocks.queueObjectDeletion,
  buildR2UserPrefix: r2Mocks.buildR2UserPrefix,
  buildR2ObjectKey: r2Mocks.buildR2ObjectKey,
  r2: r2Mocks.r2,
});
