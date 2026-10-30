import { FILES_UPLOAD_MAX_BYTES } from "@teak/files-protocol";
import {
  RENDERER_ERROR_STATUS,
  RENDERER_PROTOCOL,
} from "../../container/src/protocol";
import { OpFailure } from "../opFailure";

export interface RendererEnv {
  MEDIA_RENDERER?: DurableObjectNamespace;
  MEDIA_RENDERER_INSTANCES?: string;
}

export class RendererDeclined extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`renderer_declined:${reason}`);
    this.reason = reason;
  }
}

export class RendererUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`renderer_unavailable:${reason}`);
    this.reason = reason;
  }
}

export interface RendererSource {
  body: ReadableStream;
  contentType?: string;
  size: number;
}

export type RendererPartKind = "jpeg" | "mp3" | "png" | "text";

export interface RendererPartSpec {
  kind: RendererPartKind;
  maxBytes: number;
  required: boolean;
}

export interface RendererManifest {
  facts: Record<string, unknown> | null;
  parts: Array<{ length: number; name: string; type: string }>;
  protocol: number;
  [field: string]: unknown;
}

export interface RendererResult {
  manifest: RendererManifest;
  parts: Map<string, Uint8Array>;
}

const DEFAULT_POOL_SIZE = 2;
const MAX_POOL_SIZE = 16;
const STARTUP_ALLOWANCE_MS = 25_000;
const MAX_MANIFEST_CHARS = 64 * 1024;

const SIGNATURES: Record<
  Exclude<RendererPartKind, "text">,
  (bytes: Uint8Array) => boolean
> = {
  jpeg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  // An ID3 tag or an MPEG audio frame sync (11 set bits: 0xFF, then >= 0xE0).
  mp3: (bytes) =>
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0),
  png: (bytes) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value
    ),
};

export const rendererPoolSize = (env: RendererEnv): number => {
  const parsed = Number(env.MEDIA_RENDERER_INSTANCES);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_POOL_SIZE)
    : DEFAULT_POOL_SIZE;
};

export const rendererInstanceOrder = (
  size: number,
  random: () => number = Math.random,
  prefix = "renderer"
): string[] => {
  const start = Math.floor(random() * size) % size;
  return Array.from(
    { length: size },
    (_, index) => `${prefix}-${(start + index) % size}`
  );
};

const readErrorCode = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  const code = typeof body?.error === "string" ? body.error : "";
  const message = typeof body?.message === "string" ? body.message : "";
  return message ? `${code}:${message}`.slice(0, 200) : code;
};

const parseManifest = (header: string | null): RendererManifest => {
  if (!header || header.length > MAX_MANIFEST_CHARS) {
    throw new RendererUnavailable("manifest_missing");
  }
  let manifest: RendererManifest;
  try {
    manifest = JSON.parse(header) as RendererManifest;
  } catch {
    throw new RendererUnavailable("manifest_invalid");
  }
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.protocol !== RENDERER_PROTOCOL ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.some(
      (part) =>
        !part ||
        typeof part.name !== "string" ||
        typeof part.type !== "string" ||
        !Number.isSafeInteger(part.length) ||
        part.length < 0
    ) ||
    !(manifest.facts === null || typeof manifest.facts === "object")
  ) {
    throw new RendererUnavailable("manifest_invalid");
  }
  return manifest;
};

const readBodyExactly = async (
  response: Response,
  length: number
): Promise<Uint8Array> => {
  const bytes = new Uint8Array(length);
  let offset = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    if (length === 0) {
      return bytes;
    }
    throw new RendererUnavailable("output_truncated");
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (offset + value.byteLength > length) {
      await reader.cancel().catch(() => undefined);
      throw new RendererUnavailable("output_overflow");
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== length) {
    throw new RendererUnavailable("output_truncated");
  }
  return bytes;
};

export const readRendererOutputs = async (
  response: Response,
  specs: Record<string, RendererPartSpec>
): Promise<RendererResult> => {
  const manifest = parseManifest(response.headers.get("x-teak-manifest"));
  let total = 0;
  for (const part of manifest.parts) {
    const spec = specs[part.name];
    if (!spec || part.length === 0 || part.length > spec.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new RendererUnavailable(`output_invalid:${part.name}`);
    }
    total += part.length;
  }
  if (
    new Set(manifest.parts.map((part) => part.name)).size !==
    manifest.parts.length
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new RendererUnavailable("output_invalid:duplicate");
  }
  const body = await readBodyExactly(response, total);
  const parts = new Map<string, Uint8Array>();
  let offset = 0;
  for (const part of manifest.parts) {
    const bytes = body.subarray(offset, offset + part.length);
    offset += part.length;
    const kind = specs[part.name]?.kind;
    if (kind && kind !== "text" && !SIGNATURES[kind](bytes)) {
      throw new RendererUnavailable(`output_invalid:${part.name}`);
    }
    parts.set(part.name, bytes);
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.required && !parts.has(name)) {
      throw new RendererUnavailable(`output_missing:${name}`);
    }
  }
  return { manifest, parts };
};

const { FixedLengthStream: FixedLength } = globalThis as unknown as {
  FixedLengthStream: typeof FixedLengthStream;
};

const withFixedLength = (source: RendererSource): ReadableStream => {
  // Workers send a stream with an unknown length as chunked; FixedLengthStream
  // gives the Container a Content-Length to check against its cap up front.
  const { readable, writable } = new FixedLength(source.size);
  source.body.pipeTo(writable).catch(() => undefined);
  return readable;
};

export const callRenderer = async (
  env: RendererEnv,
  job: {
    openSource: () => Promise<RendererSource>;
    outputs: Record<string, RendererPartSpec>;
    path: string;
    timeoutMs: number;
  },
  random: () => number = Math.random
): Promise<RendererResult> => {
  const namespace = env.MEDIA_RENDERER;
  if (!namespace) {
    throw new RendererUnavailable("binding_missing");
  }
  let lastReason = "busy";
  for (const name of rendererInstanceOrder(rendererPoolSize(env), random)) {
    const source = await job.openSource();
    if (source.size > FILES_UPLOAD_MAX_BYTES) {
      await source.body.cancel().catch(() => undefined);
      throw new OpFailure("source_too_large");
    }
    let response: Response;
    try {
      response = await namespace.get(namespace.idFromName(name)).fetch(
        new Request(`http://renderer${job.path}`, {
          body: withFixedLength(source),
          headers: { "content-type": "application/octet-stream" },
          method: "POST",
          signal: AbortSignal.timeout(job.timeoutMs + STARTUP_ALLOWANCE_MS),
        })
      );
    } catch (error) {
      await source.body.cancel().catch(() => undefined);
      throw new RendererUnavailable(
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "request_failed"
      );
    }
    if (response.ok) {
      return await readRendererOutputs(response, job.outputs);
    }
    const reason = await readErrorCode(response);
    switch (response.status) {
      case RENDERER_ERROR_STATUS.busy:
        lastReason = reason || "unavailable";
        continue;
      case RENDERER_ERROR_STATUS.too_large:
        throw new OpFailure("source_too_large");
      case RENDERER_ERROR_STATUS.unsupported:
        throw new RendererDeclined(reason || "unsupported");
      case RENDERER_ERROR_STATUS.timeout:
        throw new RendererDeclined(reason || "timeout");
      case RENDERER_ERROR_STATUS.bad_request:
        throw new Error(`renderer_bad_request:${reason}`);
      default:
        throw new RendererUnavailable(
          `status_${String(response.status)}${reason ? `:${reason}` : ""}`
        );
    }
  }
  throw new RendererUnavailable(lastReason);
};

export const checkRendererHealth = async (
  env: RendererEnv
): Promise<{ rendererHealthy: boolean; rendererProtocol: number | null }> => {
  const namespace = env.MEDIA_RENDERER;
  if (!namespace) {
    return { rendererHealthy: false, rendererProtocol: null };
  }
  try {
    const response = await namespace
      .get(namespace.idFromName(rendererInstanceOrder(1)[0] as string))
      .fetch(
        new Request("http://renderer/health", {
          signal: AbortSignal.timeout(STARTUP_ALLOWANCE_MS),
        })
      );
    const health = (await response.json().catch(() => null)) as {
      protocol?: unknown;
    } | null;
    const protocol =
      typeof health?.protocol === "number" ? health.protocol : null;
    return {
      rendererHealthy: response.ok && protocol === RENDERER_PROTOCOL,
      rendererProtocol: protocol,
    };
  } catch {
    return { rendererHealthy: false, rendererProtocol: null };
  }
};
