import { buildCardObjectKey, filesCardKeyPrefix } from "@teak/files-protocol";
import { getR2KeyPrefix } from "./r2Keys";

/** Where an upload waits for its card; the protocol owns the segment. */
export { FILES_PENDING_CARD_SEGMENT as PENDING_UPLOAD_CARD_ID } from "@teak/files-protocol";
export { cardStorageObjectKeys } from "./cardObjectKeys";

export const buildR2UserPrefix = (userId: string) =>
  filesCardKeyPrefix(getR2KeyPrefix(), userId);

export const buildR2ObjectKey = (args: {
  userId: string;
  cardId?: string;
  role: string;
  fileName?: string;
  objectId?: string;
}) => buildCardObjectKey({ envPrefix: getR2KeyPrefix(), ...args });
