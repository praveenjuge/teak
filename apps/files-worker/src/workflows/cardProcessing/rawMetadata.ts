import { filesCardKeyPrefix } from "@teak/files-protocol";
import { sha256Hex } from "../../lib";

const RAW_METADATA_MAX_BYTES = 512 * 1024;
type RawMetadataKind = "linkCategory" | "linkPreview";

export const rawMetadataKey = (
  keyPrefix: string,
  card: { _id: string; userId: string },
  kind: RawMetadataKind,
  digest: string
): string => {
  if (!(/^[a-f0-9]{64}$/.test(digest) && /^[a-z0-9]+$/i.test(card._id))) {
    throw new Error("raw_metadata_invalid_key");
  }
  return `${filesCardKeyPrefix(keyPrefix, card.userId)}/${card._id}/raw-${kind}/${digest}.json`;
};

const readArchivedRaw = async (
  bucket: R2Bucket,
  key: string,
  digest: string
): Promise<unknown> => {
  const object = await bucket.get(key);
  if (!object) {
    throw new Error("raw_metadata_read_failed:404");
  }
  if (object.size > RAW_METADATA_MAX_BYTES) {
    await object.body.cancel().catch(() => undefined);
    throw new Error(`body_too_large: ${object.size}`);
  }
  const json = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  }).decode(await object.arrayBuffer());
  if ((await sha256Hex(json)) !== digest) {
    throw new Error("raw_metadata_hash_mismatch");
  }
  return JSON.parse(json);
};

interface ArchivablePart {
  raw?: unknown;
  rawSha256?: string;
  rawStorageKey?: string;
}

export const hydrateArchivedMetadata = async <
  T extends {
    _id: string;
    metadata?: {
      linkCategory?: ArchivablePart;
      linkPreview?: ArchivablePart;
    };
    userId?: string;
  },
>(
  env: { BUCKET: R2Bucket },
  keyPrefix: string,
  card: T
): Promise<T> => {
  if (!card.metadata) {
    return card;
  }
  const metadata = { ...card.metadata };
  for (const kind of ["linkPreview", "linkCategory"] as const) {
    const part = metadata[kind];
    if (part && part.raw === undefined && part.rawStorageKey) {
      if (!(part.rawSha256 && /^[a-f0-9]{64}$/.test(part.rawSha256))) {
        throw new Error("raw_metadata_digest_missing");
      }
      const key = card.userId
        ? rawMetadataKey(
            keyPrefix,
            { _id: card._id, userId: card.userId },
            kind,
            part.rawSha256
          )
        : null;
      if (!key || part.rawStorageKey !== key) {
        throw new Error("raw_metadata_card_namespace_mismatch");
      }
      const raw = await readArchivedRaw(env.BUCKET, key, part.rawSha256);
      Object.assign(metadata, { [kind]: { ...part, raw } });
    }
  }
  return { ...card, metadata };
};
