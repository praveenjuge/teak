import type { Doc } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { readBodyWithLimit } from "../linkMetadata/ssrf";
import { putObjectViaFilesWorker } from "./filesWorkerClient";
import { getR2Url } from "./fileUrls";
import { buildR2UserPrefix } from "./r2";

export const RAW_METADATA_MAX_BYTES = 512 * 1024;
export type RawMetadataKind = "linkPreview" | "linkCategory";

// JSON is lossless only for this subset of Convex values. Leave unsupported
// values inline rather than silently converting bytes, bigint, or non-finite numbers.
const isJsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every(isJsonValue)
  );
};

export const serializeRawMetadata = (raw: unknown): string | null => {
  if (!isJsonValue(raw)) {
    return null;
  }
  const json = JSON.stringify(raw);
  return new TextEncoder().encode(json).byteLength <= RAW_METADATA_MAX_BYTES
    ? json
    : null;
};

// Avoid trading small database reads for thousands of R2 PUT/GET operations.
export const serializeArchivableRaw = (raw: unknown): string | null => {
  const json = serializeRawMetadata(raw);
  return json !== null && new TextEncoder().encode(json).byteLength >= 1024
    ? json
    : null;
};

export const hashRawMetadata = async (json: string): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json)
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

export const rawMetadataKey = (
  card: Pick<Doc<"cards">, "_id" | "userId">,
  kind: RawMetadataKind,
  digest: string
) => {
  if (
    !(
      /^[a-f0-9]{64}$/.test(digest) &&
      /^[a-z0-9]+$/i.test(card._id) &&
      ["linkPreview", "linkCategory"].includes(kind)
    )
  ) {
    throw new Error("raw_metadata_invalid_key");
  }
  return `${buildR2UserPrefix(card.userId)}/${card._id}/raw-${kind}/${digest}.json`;
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
    signedUrl.origin !== base.origin ||
    signedUrl.pathname !== `/${key}`
  ) {
    throw new Error("raw_metadata_invalid_read_origin");
  }
  const response = await fetch(signedUrl.toString(), {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`raw_metadata_read_failed:${response.status}`);
  }
  const json = new TextDecoder("utf-8", { fatal: true }).decode(
    await readBodyWithLimit(response, RAW_METADATA_MAX_BYTES)
  );
  if ((await hashRawMetadata(json)) !== digest) {
    throw new Error("raw_metadata_hash_mismatch");
  }
  return JSON.parse(json);
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
  // Verify through the independent signed read endpoint before changing the DB.
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
  for (const kind of ["linkPreview", "linkCategory"] as const) {
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
