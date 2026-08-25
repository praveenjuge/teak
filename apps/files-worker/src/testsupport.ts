// Test-only helpers. Never imported by src/index.ts, so none of this ships in
// the deployed worker bundle.

import { crc32, deflateSync } from "node:zlib";

/* ------------------------------------------------------------------ *
 * Minimal PNG encoder (truecolor + alpha) so image tests can build
 * deterministic fixtures of any dimension without binary assets.
 * ------------------------------------------------------------------ */

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  const typed = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(typed));
  return out;
};

/** Encode a solid-color RGBA PNG of the given dimensions. */
export const makePng = (
  width: number,
  height: number,
  rgba: [number, number, number, number] = [255, 0, 0, 255]
): Uint8Array => {
  const rowLength = 1 + width * 4;
  const raw = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowLength;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      raw[offset] = rgba[0];
      raw[offset + 1] = rgba[1];
      raw[offset + 2] = rgba[2];
      raw[offset + 3] = rgba[3];
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/* ------------------------------------------------------------------ *
 * In-memory R2 bucket double covering the binding surface the worker
 * uses: get/head/put plus multipart uploads. Methods are synchronous
 * under the hood; awaiting their plain results behaves identically.
 * ------------------------------------------------------------------ */

export interface FakeStoredObject {
  bytes: Uint8Array | null;
  httpMetadata?: Record<string, string>;
}

interface PutRecord {
  bytes: Uint8Array;
  httpMetadata?: Record<string, string>;
  key: string;
}

const asBody = (bytes: Uint8Array) => {
  const copy =
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
      ? bytes
      : bytes.slice();
  return {
    // A real ReadableStream — client-zip instanceof-checks its inputs.
    body: new Response(new Uint8Array(copy)).body as ReadableStream,
    arrayBuffer: async () =>
      copy.buffer.slice(
        copy.byteOffset,
        copy.byteOffset + copy.byteLength
      ) as ArrayBuffer,
    text: async () => new TextDecoder().decode(copy),
    json: async () => JSON.parse(new TextDecoder().decode(copy)),
  };
};

/** Stable fake validator mirroring R2's httpEtag behavior. */
export const fakeHttpEtag = (bytes: Uint8Array): string => {
  let hash = 0x81_1c_9d_c5;
  for (const byte of bytes) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hashing is bitwise by nature.
    hash ^= byte;
    // biome-ignore lint/suspicious/noBitwiseOperators: force unsigned comparison via shift.
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return `"${hash.toString(16)}-${bytes.length.toString(16)}"`;
};

/** Deterministic fixture loader for tests (never shipped in the worker). */
export const readFixture = async (path: string): Promise<Uint8Array> => {
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(path));
};

export class FakeBucket {
  objects = new Map<string, FakeStoredObject>();
  puts: PutRecord[] = [];
  multipartCompletions: Array<{ key: string; bytes: Uint8Array }> = [];
  failKeys = new Set<string>();
  failMultipartPartOnce = new Set<number>();
  multipartUploads = new Map<
    string,
    {
      key: string;
      options?: { httpMetadata?: Record<string, string> };
      parts: Map<number, Uint8Array>;
    }
  >();

  get(key: string, options?: { range?: { offset?: number; length?: number } }) {
    if (this.failKeys.has(key)) {
      return null;
    }
    const stored = this.objects.get(key);
    if (!stored?.bytes) {
      return null;
    }
    const bytes = stored.bytes;
    let slice = bytes;
    const range = options?.range;
    if (range?.offset !== undefined || range?.length !== undefined) {
      const start = range?.offset ?? 0;
      const end =
        range?.length === undefined ? slice.length : start + range.length;
      slice = slice.subarray(start, Math.min(end, slice.length));
    }
    return {
      ...asBody(slice),
      // R2 reports the full object size even on ranged gets.
      size: bytes.length,
      httpEtag: fakeHttpEtag(bytes),
      httpMetadata: stored.httpMetadata,
    };
  }

  head(key: string) {
    const stored = this.objects.get(key);
    if (!stored) {
      return null;
    }
    return {
      key,
      size: stored.bytes?.length ?? 0,
      httpEtag: stored.bytes ? fakeHttpEtag(stored.bytes) : "",
      httpMetadata: stored.httpMetadata,
    };
  }

  async put(
    key: string,
    value: Blob | Uint8Array | ReadableStream | string,
    options?: { httpMetadata?: Record<string, string> }
  ) {
    let bytes: Uint8Array;
    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof Uint8Array) {
      bytes = value.slice();
    } else {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    }
    this.puts.push({ key, bytes, httpMetadata: options?.httpMetadata });
    this.objects.set(key, { bytes, httpMetadata: options?.httpMetadata });
    return { httpEtag: fakeHttpEtag(bytes) };
  }

  delete(key: string | string[]) {
    if (Array.isArray(key)) {
      // Batch deletes treat missing objects as success.
      for (const single of key) {
        this.objects.delete(single);
      }
      return;
    }
    this.objects.delete(key);
  }

  createMultipartUpload(
    key: string,
    options?: { httpMetadata?: Record<string, string> }
  ) {
    const uploadId = `upload-${this.multipartUploads.size + 1}`;
    this.multipartUploads.set(uploadId, {
      key,
      options,
      parts: new Map(),
    });
    return this.resumeMultipartUpload(key, uploadId);
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    const upload = this.multipartUploads.get(uploadId);
    if (!upload || upload.key !== key) {
      throw new Error("multipart_not_found");
    }
    return {
      key,
      uploadId,
      uploadPart: async (
        partNumber: number,
        value: Uint8Array | ReadableStream
      ) => {
        if (this.failMultipartPartOnce.delete(partNumber)) {
          throw new Error(`multipart_part_${partNumber}_failed`);
        }
        const bytes =
          value instanceof Uint8Array
            ? value.slice()
            : new Uint8Array(await new Response(value).arrayBuffer());
        upload.parts.set(partNumber, bytes);
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: (completed?: Array<{ partNumber: number }>) => {
        const parts = (
          completed ??
          [...upload.parts.keys()].map((partNumber) => ({ partNumber }))
        )
          .map(({ partNumber }) => upload.parts.get(partNumber))
          .filter((part): part is Uint8Array => Boolean(part));
        const total = parts.reduce((sum, part) => sum + part.length, 0);
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        this.multipartCompletions.push({ key, bytes });
        this.objects.set(key, {
          bytes,
          httpMetadata: upload.options?.httpMetadata,
        });
        this.multipartUploads.delete(uploadId);
        return { key, size: bytes.length, httpEtag: fakeHttpEtag(bytes) };
      },
      abort: () => {
        this.multipartUploads.delete(uploadId);
        return Promise.resolve();
      },
    };
  }

  /** Bytes stored under a key via put() or a completed multipart upload. */
  storedBytes(key: string): Uint8Array | null {
    return this.objects.get(key)?.bytes ?? null;
  }
}
