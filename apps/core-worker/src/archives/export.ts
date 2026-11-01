import {
  FILES_EXPORT_MANIFEST_VERSION,
  type FilesExportManifest,
} from "@teak/files-protocol";
import { downloadZip } from "client-zip";

const MISSING_FILE_MAX_ATTEMPTS = 2;

// R2 multipart parts (min 5 MiB except last). 32 MiB keeps peak memory low on
// the Workers runtime while capping part count far below limits even for the
// 5 GB export ceiling.
const PART_SIZE = 32 * 1024 * 1024;

export class ExportManifestInvalid extends Error {
  constructor() {
    super("manifest_invalid");
  }
}

export class ExportTooLarge extends Error {
  constructor() {
    super("export_too_large");
  }
}

export interface BuildExportResult {
  artifactBytes: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedPaths: string[];
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const isValidArchivePath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.split("/").includes("..") &&
  !path.includes("\0");

export const parseExportManifest = (raw: string): FilesExportManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExportManifestInvalid();
  }
  const manifest = parsed as FilesExportManifest;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.v !== FILES_EXPORT_MANIFEST_VERSION ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length === 0 ||
    typeof manifest.maxBytes !== "number" ||
    !(manifest.maxBytes > 0)
  ) {
    throw new ExportManifestInvalid();
  }
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== "string") {
      throw new ExportManifestInvalid();
    }
    if (!isValidArchivePath(entry.path)) {
      throw new ExportManifestInvalid();
    }
    if (entry.contentBase64 === undefined && !entry.storageKey) {
      throw new ExportManifestInvalid();
    }
  }
  return manifest;
};

const getOrNull = async (
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> => {
  try {
    return await bucket.get(key);
  } catch {
    return null;
  }
};

const readWithRetry = async (
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> => {
  for (let attempt = 0; attempt < MISSING_FILE_MAX_ATTEMPTS; attempt += 1) {
    const object = await getOrNull(bucket, key);
    if (object) {
      return object;
    }
  }
  return null;
};

interface ZipInput {
  input: ReadableStream | Uint8Array;
  lastModified: Date;
  name: string;
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const collectZipInputs = async function* (
  bucket: R2Bucket,
  manifest: FilesExportManifest,
  lastModified: Date,
  stats: {
    filesIncluded: number;
    filesOmitted: number;
    omittedPaths: string[];
    totalBytes: number;
  }
): AsyncGenerator<ZipInput> {
  for (const entry of manifest.entries) {
    if (entry.contentBase64 !== undefined) {
      const bytes = base64ToBytes(entry.contentBase64);
      stats.totalBytes += bytes.byteLength;
      if (stats.totalBytes > manifest.maxBytes) {
        throw new ExportTooLarge();
      }
      yield { name: entry.path, input: bytes, lastModified };
      continue;
    }

    const key = entry.storageKey as string;
    const object = await readWithRetry(bucket, key);
    if (!object || object.size === 0) {
      await object?.body.cancel().catch(() => undefined);
      stats.filesOmitted += 1;
      stats.omittedPaths.push(entry.path);
      continue;
    }
    stats.totalBytes += object.size;
    if (stats.totalBytes > manifest.maxBytes) {
      await object.body.cancel();
      throw new ExportTooLarge();
    }
    stats.filesIncluded += 1;
    yield { name: entry.path, input: object.body, lastModified };
  }
};

export const buildExportIntoBucket = async (
  bucket: R2Bucket,
  manifestKey: string,
  artifactKey: string,
  fileName: string,
  // Tests pass a small size so a few kilobytes span several parts.
  partSize = PART_SIZE
): Promise<BuildExportResult> => {
  const manifestObject = await bucket.get(manifestKey);
  if (!manifestObject) {
    throw new ExportManifestInvalid();
  }
  const manifest = parseExportManifest(await manifestObject.text());
  const manifestEtag = manifestObject.httpEtag;
  const checkpointKey = `${artifactKey}.checkpoint.json`;
  const resultKey = `${artifactKey}.result.json`;
  const cachedResult = await bucket.get(resultKey);
  if (cachedResult) {
    const cached = (await cachedResult.json()) as BuildExportResult & {
      manifestEtag: string;
    };
    if (
      cached.manifestEtag === manifestEtag &&
      (await bucket.head(artifactKey))
    ) {
      return cached;
    }
  }

  type CheckpointPart = R2UploadedPart & { sha256?: string; size: number };
  type Checkpoint = BuildExportResult & {
    artifactBytes: number;
    completeReady: boolean;
    // Every entry carries this time, so a resumed attempt rebuilds the same
    // bytes instead of stamping entries with the time of the retry.
    lastModified?: number;
    manifestEtag: string;
    parts: CheckpointPart[];
    uploadId: string;
  };
  let checkpoint: Checkpoint | null = null;
  const checkpointObject = await bucket.get(checkpointKey);
  if (checkpointObject) {
    const candidate = (await checkpointObject.json()) as Checkpoint;
    if (candidate.manifestEtag === manifestEtag) {
      checkpoint = candidate;
    }
  }

  if (checkpoint?.completeReady && (await bucket.head(artifactKey))) {
    const result = {
      artifactBytes: checkpoint.artifactBytes,
      filesIncluded: checkpoint.filesIncluded,
      filesOmitted: checkpoint.filesOmitted,
      omittedPaths: checkpoint.omittedPaths,
    };
    await bucket.put(
      resultKey,
      new Blob([JSON.stringify({ ...result, manifestEtag })]),
      { httpMetadata: { contentType: "application/json" } }
    );
    await bucket.delete(checkpointKey);
    return result;
  }

  const mpu = checkpoint
    ? bucket.resumeMultipartUpload(artifactKey, checkpoint.uploadId)
    : await bucket.createMultipartUpload(artifactKey, {
        httpMetadata: {
          contentType: "application/zip",
          contentDisposition: `attachment; filename="${fileName.replace(/["\\]/g, "")}"`,
        },
      });

  const stats = {
    filesIncluded: 0,
    filesOmitted: 0,
    omittedPaths: [] as string[],
    totalBytes: 0,
  };

  const lastModified = checkpoint?.lastModified ?? Date.now();
  const zipStream = downloadZip(
    collectZipInputs(bucket, manifest, new Date(lastModified), stats)
  ).body;
  if (!zipStream) {
    throw new Error("zip_stream_unavailable");
  }

  const reader = zipStream.getReader();
  const buffer = new Uint8Array(partSize);
  let fill = 0;
  let artifactBytes = 0;
  const checkpointParts = checkpoint?.parts ?? [];
  const uploadedParts: CheckpointPart[] = [];
  let nextPartNumber = 1;

  const flushPart = async (bytes: Uint8Array): Promise<void> => {
    // A resumed attempt rebuilds the archive from the start, and its bytes can
    // differ from the first attempt's (a file that read as missing, say). Reuse
    // a checkpointed part only when its content is identical; otherwise upload
    // the rebuilt part over it.
    const sha256 = await sha256Hex(bytes);
    const existing = checkpointParts[nextPartNumber - 1];
    if (existing?.sha256 === sha256) {
      uploadedParts.push(existing);
    } else {
      // uploadPart requires a stable copy; slice() detaches from our scratch
      // buffer so it can be reused immediately afterwards.
      const part = await mpu.uploadPart(nextPartNumber, bytes.slice());
      uploadedParts.push({ ...part, sha256, size: bytes.byteLength });
      await bucket.put(
        checkpointKey,
        new Blob([
          JSON.stringify({
            artifactBytes: artifactBytes + bytes.byteLength,
            completeReady: false,
            filesIncluded: stats.filesIncluded,
            filesOmitted: stats.filesOmitted,
            lastModified,
            manifestEtag,
            omittedPaths: stats.omittedPaths,
            parts: [...uploadedParts, ...checkpointParts.slice(nextPartNumber)],
            uploadId: mpu.uploadId,
          } satisfies Checkpoint),
        ]),
        { httpMetadata: { contentType: "application/json" } }
      );
    }
    artifactBytes += bytes.byteLength;
    nextPartNumber += 1;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    let offset = 0;
    while (offset < value.length) {
      const take = Math.min(partSize - fill, value.length - offset);
      buffer.set(value.subarray(offset, offset + take), fill);
      fill += take;
      offset += take;
      if (fill === partSize) {
        await flushPart(buffer.subarray(0, fill));
        fill = 0;
      }
    }
  }
  if (fill > 0) {
    await flushPart(buffer.subarray(0, fill));
  } else if (uploadedParts.length === 0) {
    await flushPart(buffer.subarray(0, 0));
  }

  const result = {
    artifactBytes,
    filesIncluded: stats.filesIncluded,
    filesOmitted: stats.filesOmitted,
    omittedPaths: stats.omittedPaths,
  };
  await bucket.put(
    checkpointKey,
    new Blob([
      JSON.stringify({
        ...result,
        completeReady: true,
        lastModified,
        manifestEtag,
        parts: uploadedParts,
        uploadId: mpu.uploadId,
      } satisfies Checkpoint),
    ]),
    { httpMetadata: { contentType: "application/json" } }
  );
  await mpu.complete(uploadedParts);
  await bucket.put(
    resultKey,
    new Blob([JSON.stringify({ ...result, manifestEtag })]),
    { httpMetadata: { contentType: "application/json" } }
  );
  await bucket.delete(checkpointKey);
  return result;
};
