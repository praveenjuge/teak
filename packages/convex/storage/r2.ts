import { buildCardObjectKey, filesCardKeyPrefix } from "@teak/files-protocol";
import type { MutationCtx } from "../_generated/server";

export { cardStorageObjectKeys } from "./cardObjectKeys";

import { enqueueObjectDeletion } from "../workflowDispatch";
import { assertR2KeyInNamespace, getR2KeyPrefix } from "./r2Keys";

export const PENDING_UPLOAD_CARD_ID = "upload-pending-v2";

export const buildR2UserPrefix = (userId: string) =>
  filesCardKeyPrefix(getR2KeyPrefix(), userId);

export const buildR2ObjectKey = (args: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
  objectId?: string;
}) => buildCardObjectKey({ envPrefix: getR2KeyPrefix(), ...args });

export const queueObjectDeletion = async (ctx: MutationCtx, key?: string) => {
  if (!key) {
    return;
  }
  assertR2KeyInNamespace(key);
  await enqueueObjectDeletion(ctx, [key]);
};
