import {
  archivedRawSummary,
  RAW_METADATA_MAX_BYTES,
  type RawMetadataKind,
  serializeArchivableRaw,
} from "@teak/convex/storage/rawMetadataJson";
import { filesCardKeyPrefix } from "@teak/files-protocol";
import { convexToJson, jsonToConvex, type Value } from "convex/values";
import { sha256Hex } from "../../lib";
import { gatedEnv } from "../filesOps";
import { type CardJob, ensureObjectOwnership } from "./context";

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

/**
 * The archivable JSON of `raw` as Convex would store it: the RPC drops
 * undefined fields (a selector result without attributes), so the digest
 * matches the one Convex's own archive would compute.
 */
const storedRawJson = (raw: unknown): string | null => {
  if (raw === undefined) {
    return null;
  }
  try {
    return serializeArchivableRaw(jsonToConvex(convexToJson(raw as Value)));
  } catch {
    return null;
  }
};

/**
 * Moves a part's raw provider payload to R2 before the part reaches Convex,
 * so the card stores only the reference and Convex never schedules its own
 * archive. Same rules as `storage/rawMetadataMaintenance:archiveCard`: tiny or
 * non-lossless JSON stays inline, and the object is read back and its hash
 * and JSON checked first. A superseded run (a `NonRetryableError` from the
 * guarded ownership write) ends the step; any other failure keeps the payload
 * inline, which Convex then archives as before.
 */
export const archiveRawMetadata = async <T extends ArchivablePart>(
  job: CardJob,
  owner: { keyPrefix: string; userId: string },
  kind: RawMetadataKind,
  part: T
): Promise<T> => {
  const json = storedRawJson(part.raw);
  if (json === null) {
    return part;
  }
  try {
    const digest = await sha256Hex(json);
    const key = rawMetadataKey(
      owner.keyPrefix,
      { _id: job.cardId, userId: owner.userId },
      kind,
      digest
    );
    await ensureObjectOwnership(job, owner.userId, key);
    const bucket = gatedEnv(job.env).BUCKET;
    await bucket.put(key, json, {
      httpMetadata: { contentType: "application/json" },
    });
    const restored = await readArchivedRaw(bucket, key, digest);
    if (JSON.stringify(restored) !== json) {
      throw new Error("raw_metadata_roundtrip_mismatch");
    }
    const { raw: _archived, ...rest } = part;
    return {
      ...rest,
      rawSha256: digest,
      rawStorageKey: key,
      ...archivedRawSummary(kind, part.raw),
    } as T;
  } catch (error) {
    if (error instanceof Error && error.name === "NonRetryableError") {
      throw error;
    }
    console.warn("[rawMetadata] Archive failed; keeping raw inline", {
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return part;
  }
};

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
