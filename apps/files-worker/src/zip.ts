import { isSafeArchivePath } from "@teak/convex/import/validate";
import { Inflate } from "fflate";
import { isValidUploadKey } from "./upload";

export class InspectSourceMissing extends Error {
  constructor() {
    super("source_not_found");
  }
}
export class ArchiveEntryTooLargeError extends Error {
  constructor() {
    super("Expanded ZIP entry exceeds its limit");
  }
}
export interface ZipCentralEntry {
  compressedSize: number;
  compressionMethod: number;
  flags?: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}
interface EocdRecord {
  cdOffset: number;
  cdSize: number;
  entryCount: number;
  offset: number;
}
const EOCD_WINDOW = 22 + 65_535;
const MAX_DIRECTORY = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;
const MAX_ENTRIES = 20_002;
const MAX_RATIO = 100;
const u16 = (b: Uint8Array, i: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(i, true);
const u32 = (b: Uint8Array, i: number) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i, true);
const u64 = (b: Uint8Array, i: number) => {
  const n = Number(
    new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(i, true)
  );
  if (!Number.isSafeInteger(n)) {
    throw new Error("archive_parse_failed");
  }
  return n;
};
export async function rangeRead(
  bucket: R2Bucket,
  key: string,
  offset: number,
  length: number,
  etag?: string
): Promise<Uint8Array> {
  if (
    !(Number.isSafeInteger(offset) && Number.isSafeInteger(length)) ||
    offset < 0 ||
    length < 0 ||
    length > MAX_DIRECTORY
  ) {
    throw new Error("archive_parse_failed");
  }
  if (!length) {
    return new Uint8Array();
  }
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) {
    throw new InspectSourceMissing();
  }
  if (etag && etag !== object.httpEtag) {
    await object.body.cancel();
    throw new Error("source_changed");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== length) {
    throw new Error("archive_parse_failed");
  }
  return bytes;
}
export function findEocd(tail: Uint8Array): EocdRecord | null {
  for (
    let i = tail.length - 22;
    i >= Math.max(0, tail.length - EOCD_WINDOW);
    i--
  ) {
    if (
      u32(tail, i) !== 0x06_05_4b_50 ||
      i + 22 + u16(tail, i + 20) !== tail.length
    ) {
      continue;
    }
    if (
      u16(tail, i + 4) !== 0 ||
      u16(tail, i + 6) !== 0 ||
      u16(tail, i + 8) !== u16(tail, i + 10)
    ) {
      throw new Error("archive_parse_failed");
    }
    return {
      entryCount: u16(tail, i + 10),
      cdSize: u32(tail, i + 12),
      cdOffset: u32(tail, i + 16),
      offset: i,
    };
  }
  return null;
}
export function parseCentralDirectory(
  bytes: Uint8Array,
  count: number
): ZipCentralEntry[] {
  if (count > MAX_ENTRIES) {
    throw new Error("invalid_archive_entry_count");
  }
  const entries: ZipCentralEntry[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== 0x02_01_4b_50) {
      throw new Error("archive_parse_failed");
    }
    const nl = u16(bytes, offset + 28),
      el = u16(bytes, offset + 30),
      cl = u16(bytes, offset + 32);
    const end = offset + 46 + nl + el + cl;
    if (end > bytes.length) {
      throw new Error("archive_parse_failed");
    }
    const flags = u16(bytes, offset + 8);
    const entry: ZipCentralEntry = {
      name: new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + nl)
      ),
      compressionMethod: u16(bytes, offset + 10),
      compressedSize: u32(bytes, offset + 20),
      uncompressedSize: u32(bytes, offset + 24),
      localHeaderOffset: u32(bytes, offset + 42),
      flags,
    };
    let disk = u16(bytes, offset + 34);
    for (let x = offset + 46 + nl; x < offset + 46 + nl + el; ) {
      if (x + 4 > offset + 46 + nl + el) {
        throw new Error("archive_parse_failed");
      }
      const tag = u16(bytes, x),
        len = u16(bytes, x + 2),
        next = x + 4 + len;
      if (next > offset + 46 + nl + el) {
        throw new Error("archive_parse_failed");
      }
      if (tag === 1) {
        let z = x + 4;
        for (const field of [
          "uncompressedSize",
          "compressedSize",
          "localHeaderOffset",
        ] as const) {
          if (entry[field] === 0xff_ff_ff_ff) {
            if (z + 8 > next) {
              throw new Error("archive_parse_failed");
            }
            entry[field] = u64(bytes, z);
            z += 8;
          }
        }
        if (disk === 0xff_ff) {
          if (z + 4 > next) {
            throw new Error("archive_parse_failed");
          }
          disk = u32(bytes, z);
        }
      }
      x = next;
    }
    if (
      disk !== 0 ||
      [
        entry.compressedSize,
        entry.uncompressedSize,
        entry.localHeaderOffset,
      ].includes(0xff_ff_ff_ff)
    ) {
      throw new Error("archive_parse_failed");
    }
    entries.push(entry);
    offset = end;
  }
  if (offset !== bytes.length) {
    throw new Error("archive_parse_failed");
  }
  return entries;
}
export interface ZipDirectory {
  cdOffset: number;
  entries: ZipCentralEntry[];
  size: number;
  sourceEtag: string;
}
export async function readZipDirectory(
  bucket: R2Bucket,
  key: string,
  expectedEtag?: string
): Promise<ZipDirectory> {
  const meta = await bucket.head(key);
  if (!meta) {
    throw new InspectSourceMissing();
  }
  if (expectedEtag && meta.httpEtag !== expectedEtag) {
    throw new Error("source_changed");
  }
  if (meta.size < 22 || meta.size > MAX_ARCHIVE_BYTES) {
    throw new Error("archive_parse_failed");
  }
  const len = Math.min(meta.size, EOCD_WINDOW),
    start = meta.size - len;
  const tail = await rangeRead(bucket, key, start, len, meta.httpEtag);
  const eocd = findEocd(tail);
  if (!eocd) {
    throw new Error("archive_parse_failed");
  }
  let { cdOffset, cdSize, entryCount } = eocd;
  if (
    cdOffset === 0xff_ff_ff_ff ||
    cdSize === 0xff_ff_ff_ff ||
    entryCount === 0xff_ff
  ) {
    const locator = await rangeRead(
      bucket,
      key,
      start + eocd.offset - 20,
      20,
      meta.httpEtag
    );
    if (
      u32(locator, 0) !== 0x07_06_4b_50 ||
      u32(locator, 4) !== 0 ||
      u32(locator, 16) !== 1
    ) {
      throw new Error("archive_parse_failed");
    }
    const zip64 = await rangeRead(
      bucket,
      key,
      u64(locator, 8),
      56,
      meta.httpEtag
    );
    if (
      u32(zip64, 0) !== 0x06_06_4b_50 ||
      u64(zip64, 4) < 44 ||
      u32(zip64, 16) !== 0 ||
      u32(zip64, 20) !== 0 ||
      u64(zip64, 24) !== u64(zip64, 32)
    ) {
      throw new Error("archive_parse_failed");
    }
    entryCount = u64(zip64, 32);
    cdSize = u64(zip64, 40);
    cdOffset = u64(zip64, 48);
  }
  if (
    cdSize > MAX_DIRECTORY ||
    cdOffset + cdSize > start + eocd.offset ||
    entryCount > MAX_ENTRIES
  ) {
    throw new Error("archive_parse_failed");
  }
  const entries = parseCentralDirectory(
    await rangeRead(bucket, key, cdOffset, cdSize, meta.httpEtag),
    entryCount
  );
  const names = new Set<string>();
  let expanded = 0;
  for (const entry of entries) {
    if (
      !isSafeArchivePath(entry.name) ||
      /^[a-z]:/iu.test(entry.name) ||
      entry.name.split("/").includes(".") ||
      (entry.flags ?? 0) % 2 !== 0 ||
      names.has(entry.name) ||
      ![0, 8].includes(entry.compressionMethod)
    ) {
      throw new Error("invalid_archive_entry");
    }
    names.add(entry.name);
    expanded += entry.uncompressedSize;
    if (
      expanded > MAX_ARCHIVE_BYTES ||
      entry.localHeaderOffset + 30 > cdOffset
    ) {
      throw new Error("invalid_archive_expanded_size");
    }
  }
  return { entries, sourceEtag: meta.httpEtag, size: meta.size, cdOffset };
}
/** Every consumer uses the same bounded inflater, including JSON streaming. */
export async function consumeZipEntry(
  bucket: R2Bucket,
  key: string,
  directory: ZipDirectory,
  entry: ZipCentralEntry,
  limit: number,
  consume: (chunk: Uint8Array) => void,
  maxRatio = MAX_RATIO
): Promise<void> {
  if (entry.uncompressedSize > limit) {
    throw new ArchiveEntryTooLargeError();
  }
  if (
    entry.compressedSize > limit + 65_536 ||
    (entry.compressedSize === 0
      ? entry.uncompressedSize !== 0
      : entry.uncompressedSize / entry.compressedSize > maxRatio)
  ) {
    throw new Error("invalid_archive_compression_ratio");
  }
  const header = await rangeRead(
    bucket,
    key,
    entry.localHeaderOffset,
    30,
    directory.sourceEtag
  );
  if (
    u32(header, 0) !== 0x04_03_4b_50 ||
    u16(header, 8) !== entry.compressionMethod ||
    u16(header, 6) !== entry.flags
  ) {
    throw new Error("archive_parse_failed");
  }
  const nl = u16(header, 26),
    extra = u16(header, 28),
    start = entry.localHeaderOffset + 30 + nl + extra;
  if (start + entry.compressedSize > directory.cdOffset) {
    throw new Error("archive_parse_failed");
  }
  const name = new TextDecoder().decode(
    await rangeRead(
      bucket,
      key,
      entry.localHeaderOffset + 30,
      nl,
      directory.sourceEtag
    )
  );
  if (name !== entry.name) {
    throw new Error("archive_parse_failed");
  }
  let total = 0;
  const accept = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > limit || total > entry.uncompressedSize) {
      throw new ArchiveEntryTooLargeError();
    }
    consume(chunk);
  };
  const inflater = entry.compressionMethod === 8 ? new Inflate(accept) : null;
  const inflate = (chunk: Uint8Array, final: boolean) => {
    try {
      inflater?.push(chunk, final);
    } catch (error) {
      // fflate's malformed-stream errors carry a numeric code. Preserve
      // consumer size/JSON errors and normalize invalid compressed input.
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "number"
      ) {
        throw new Error("archive_parse_failed", { cause: error });
      }
      throw error;
    }
  };
  // Small compressed chunks bound even a malicious DEFLATE expansion before
  // the size check runs. Never trust the central directory's declared size.
  const object = entry.compressedSize
    ? await bucket.get(key, {
        range: { offset: start, length: entry.compressedSize },
      })
    : null;
  if (entry.compressedSize && !object) {
    throw new InspectSourceMissing();
  }
  if (object && object.httpEtag !== directory.sourceEtag) {
    await object.body.cancel();
    throw new Error("source_changed");
  }
  let read = 0;
  if (object) {
    const reader = object.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        read += value.length;
        if (read > entry.compressedSize) {
          throw new Error("archive_parse_failed");
        }
        for (let i = 0; i < value.length; i += 1024) {
          const chunk = value.subarray(i, i + 1024);
          if (inflater) {
            inflate(chunk, false);
          } else {
            accept(chunk);
          }
        }
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  if (inflater) {
    inflate(new Uint8Array(), true);
  }
  if (read !== entry.compressedSize || total !== entry.uncompressedSize) {
    throw new Error("archive_parse_failed");
  }
}
export async function readZipEntry(
  bucket: R2Bucket,
  key: string,
  directory: ZipDirectory,
  entry: ZipCentralEntry,
  limit: number,
  maxRatio = MAX_RATIO
): Promise<Uint8Array> {
  if (entry.uncompressedSize > limit) {
    throw new ArchiveEntryTooLargeError();
  }
  const bytes = new Uint8Array(entry.uncompressedSize);
  let offset = 0;
  await consumeZipEntry(
    bucket,
    key,
    directory,
    entry,
    limit,
    (chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.length;
    },
    maxRatio
  );
  return bytes;
}
export interface ExtractZipEntryRequest {
  contentType?: string;
  destinationKey: string;
  path: string;
}
export async function extractZipEntries(
  bucket: R2Bucket,
  archiveKey: string,
  requested: unknown[],
  expectedEtag?: string
): Promise<Array<{ bytes: number; destinationKey: string; path: string }>> {
  if (
    !(
      isValidUploadKey(archiveKey) &&
      Array.isArray(requested) &&
      requested.length
    ) ||
    requested.length > 50
  ) {
    throw new Error("invalid_extract_batch");
  }
  const namespace = (key: string) =>
    key
      .split("/")
      .slice(0, key.startsWith("dev/") ? 3 : 2)
      .join("/");
  const validated: ExtractZipEntryRequest[] = [];
  for (const value of requested) {
    const item = value as ExtractZipEntryRequest | null;
    if (
      !item ||
      typeof item.path !== "string" ||
      !isSafeArchivePath(item.path) ||
      typeof item.destinationKey !== "string" ||
      !isValidUploadKey(item.destinationKey) ||
      item.destinationKey === archiveKey ||
      !item.destinationKey.startsWith(`${namespace(archiveKey)}/`) ||
      (item.contentType !== undefined &&
        (typeof item.contentType !== "string" || item.contentType.length > 255))
    ) {
      throw new Error("invalid_extract_entry");
    }
    validated.push(item);
  }
  const directory = await readZipDirectory(bucket, archiveKey, expectedEtag);
  const byName = new Map(directory.entries.map((entry) => [entry.name, entry]));
  const result: Array<{ bytes: number; destinationKey: string; path: string }> =
    [];
  for (const item of validated) {
    const entry = byName.get(item.path);
    if (!entry || entry.name.endsWith("/")) {
      throw new Error("invalid_archive_entry");
    }
    const bytes = await readZipEntry(
      bucket,
      archiveKey,
      directory,
      entry,
      20 * 1024 * 1024
    );
    await bucket.put(item.destinationKey, bytes, {
      httpMetadata: {
        contentType: item.contentType ?? "application/octet-stream",
      },
      customMetadata: { sourceEtag: directory.sourceEtag },
    });
    result.push({
      bytes: bytes.length,
      destinationKey: item.destinationKey,
      path: item.path,
    });
  }
  return result;
}
