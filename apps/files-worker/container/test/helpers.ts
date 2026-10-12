// Shared client and byte parsers for the renderer integration tests. They
// run against a live renderer at RENDERER_URL (the Docker image in CI, or
// `bun src/server.ts` locally).

import { join } from "node:path";

export const RENDERER_URL = process.env.RENDERER_URL ?? "";
export const RENDERER_TIMEOUT_URL = process.env.RENDERER_TIMEOUT_URL ?? "";

export interface ManifestPart {
  length: number;
  name: string;
  type: string;
}

export interface Manifest {
  facts: {
    format: string;
    durationSeconds: number | null;
    width: number | null;
    height: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    hasVideo: boolean;
    hasAudio: boolean;
  } | null;
  parts: ManifestPart[];
  protocol: number;
  [field: string]: unknown;
}

export interface RenderResult {
  error: { error: string; message: string } | null;
  manifest: Manifest | null;
  parts: Record<string, Uint8Array>;
  status: number;
}

export function fixture(name: string): Promise<Uint8Array> {
  return Bun.file(join(import.meta.dir, "fixtures", name)).bytes();
}

export async function render(
  path: string,
  body: Uint8Array,
  baseUrl = RENDERER_URL
): Promise<RenderResult> {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", body });
  return await readResult(response);
}

export async function renderFixture(
  path: string,
  name: string,
  baseUrl = RENDERER_URL
): Promise<RenderResult> {
  return await render(path, await fixture(name), baseUrl);
}

export async function readResult(response: Response): Promise<RenderResult> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status !== 200) {
    return {
      status: response.status,
      manifest: null,
      parts: {},
      error: JSON.parse(new TextDecoder().decode(bytes)),
    };
  }
  const manifest: Manifest = JSON.parse(
    response.headers.get("x-teak-manifest") ?? "null"
  );
  const parts: Record<string, Uint8Array> = {};
  let offset = 0;
  for (const part of manifest.parts) {
    parts[part.name] = bytes.subarray(offset, offset + part.length);
    offset += part.length;
  }
  if (offset !== bytes.byteLength) {
    throw new Error(
      `Body is ${bytes.byteLength} bytes, parts add to ${offset}`
    );
  }
  return { status: 200, manifest, parts, error: null };
}

export async function health(
  baseUrl = RENDERER_URL
): Promise<{ ok: boolean; protocol: number; busy: boolean }> {
  const response = await fetch(`${baseUrl}/health`);
  return (await response.json()) as {
    ok: boolean;
    protocol: number;
    busy: boolean;
  };
}

/** Width and height from a baseline or progressive JPEG's SOF segment. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0xff_d8) {
    throw new Error("Not a JPEG");
  }
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    const marker = view.getUint16(offset);
    const isFrameHeader =
      marker >= 0xff_c0 &&
      marker <= 0xff_cf &&
      marker !== 0xff_c4 &&
      marker !== 0xff_c8 &&
      marker !== 0xff_cc;
    if (isFrameHeader) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  throw new Error("JPEG has no frame header");
}

const MPEG2_SAMPLE_RATES = [22_050, 24_000, 16_000];
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000];

/** Sample rate and channel mode of an MP3's first frame header. */
export function mp3FrameInfo(bytes: Uint8Array): {
  sampleRate: number;
  mono: boolean;
} {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2: 10-byte header plus a syncsafe size.
    offset =
      10 + bytes[6] * 2_097_152 + bytes[7] * 16_384 + bytes[8] * 128 + bytes[9];
  }
  for (; offset + 3 < bytes.byteLength; offset++) {
    if (bytes[offset] === 0xff && bytes[offset + 1] >= 0xe0) {
      const version = Math.floor(bytes[offset + 1] / 8) % 4;
      const rateIndex = Math.floor(bytes[offset + 2] / 4) % 4;
      const channelMode = Math.floor(bytes[offset + 3] / 64) % 4;
      const rates = version === 3 ? MPEG1_SAMPLE_RATES : MPEG2_SAMPLE_RATES;
      const divisor = version === 0 ? 2 : 1;
      return {
        sampleRate: rates[rateIndex] / divisor,
        mono: channelMode === 3,
      };
    }
  }
  throw new Error("No MP3 frame header");
}
