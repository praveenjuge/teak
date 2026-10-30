import type { Doc } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { readBodyWithLimit } from "../linkMetadata/ssrf";
import { putObjectViaFilesWorker } from "./filesWorkerClient";
import { getR2Url } from "./fileUrls";
import { buildR2UserPrefix } from "./r2";
import { sha256Hex } from "./r2Keys";
import {
  RAW_METADATA_KINDS,
  RAW_METADATA_MAX_BYTES,
  type RawMetadataKind,
} from "./rawMetadataJson";

export {
  archivedRawSummary,
  RAW_METADATA_KINDS,
  RAW_METADATA_MAX_BYTES,
  type RawMetadataKind,
  serializeArchivableRaw,
  serializeRawMetadata,
} from "./rawMetadataJson";

export const hashRawMetadata = (json: string): Promise<string> =>
  sha256Hex(json);

export const rawMetadataKey = (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  kind: RawMetadataKind,
  digest: string
) => {
  if (
    !(
      /^[a-f0-9]{64}$/.test(digest) &&
      /^[a-z0-9]+$/i.test(card._id) &&
      RAW_METADATA_KINDS.includes(kind)
    )
  ) {
    throw new Error("raw_metadata_invalid_key");
  }
  return `${buildR2UserPrefix(card.userId)}/${card._id}/raw-${kind}/${digest}.json`;
};

/**
 * The Core Worker archives qualifying raw payloads itself and sends the
 * reference in their place. A reference must name this card's own key for
 * that kind and digest, as hydration requires.
 */
export const assertArchivedRawReference = (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  kind: RawMetadataKind,
  part:
    | { raw?: unknown; rawSha256?: string; rawStorageKey?: string }
    | null
    | undefined
) => {
  if (part?.rawStorageKey === undefined || part.raw !== undefined) {
    return;
  }
  if (
    !part.rawSha256 ||
    part.rawStorageKey !== rawMetadataKey(card, kind, part.rawSha256)
  ) {
    throw new Error("raw_metadata_card_namespace_mismatch");
  }
};

const readArchivedRaw = async (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  kind: RawMetadataKind,
  digest: string
): Promise<unknown> => {
  const key = rawMetadataKey(card, kind, digest);
  const signedUrl = new URL(await getR2Url(key));
  const base = new URL(env.FILES_BASE ?? "");
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    signedUrl.pathname !== `/${key}`
  ) {
    throw new Error("raw_metadata_invalid_read_origin");
  }
  const allowedOrigins = [base.origin];
  if (allowedOrigins.includes(signedUrl.origin)) {
    const response = await fetch(signedUrl.toString(), {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`raw_metadata_read_failed:${response.status}`);
    }
    const json = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(await readBodyWithLimit(response, RAW_METADATA_MAX_BYTES));
    if ((await hashRawMetadata(json)) !== digest) {
      throw new Error("raw_metadata_hash_mismatch");
    }
    return JSON.parse(json);
  }
  throw new Error("raw_metadata_invalid_read_origin");
};

export const copyAndVerifyRaw = async (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  kind: RawMetadataKind,
  json: string,
  digest: string
): Promise<void> => {
  const key = rawMetadataKey(card, kind, digest);
  if ((await hashRawMetadata(json)) !== digest) {
    throw new Error("raw_metadata_hash_mismatch");
  }
  await putObjectViaFilesWorker({
    body: new TextEncoder().encode(json),
    contentType: "application/json",
    key,
    signal: AbortSignal.timeout(30_000),
  });
  const restored = await readArchivedRaw(card, kind, digest);
  if (JSON.stringify(restored) !== json) {
    throw new Error("raw_metadata_roundtrip_mismatch");
  }
};

export const hydrateArchivedMetadata = async <
  T extends Pick<Doc<"cards">, "_id" | "metadata"> & { userId?: string },
>(
  card: T
): Promise<T> => {
  if (!card.metadata) {
    return card;
  }
  const metadata = { ...card.metadata };
  for (const kind of RAW_METADATA_KINDS) {
    const part = metadata[kind];
    if (part && part.raw === undefined && part.rawStorageKey) {
      if (!(part.rawSha256 && /^[a-f0-9]{64}$/.test(part.rawSha256))) {
        throw new Error("raw_metadata_digest_missing");
      }
      if (
        !card.userId ||
        part.rawStorageKey !==
          rawMetadataKey(
            { _id: card._id, userId: card.userId },
            kind,
            part.rawSha256
          )
      ) {
        throw new Error("raw_metadata_card_namespace_mismatch");
      }
      const raw = await readArchivedRaw(
        { _id: card._id, userId: card.userId },
        kind,
        part.rawSha256
      );
      Object.assign(metadata, { [kind]: { ...part, raw } });
    }
  }
  return { ...card, metadata };
};

export const rawArchivalConfigured = () =>
  Boolean(env.FILES_BASE && env.FILES_SIGNING_SECRET);
