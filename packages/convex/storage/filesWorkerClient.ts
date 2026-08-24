/**
 * Client for internal ops on the files.teakvault.com worker (image processing,
 * export building, bounded inspection).
 *
 * Signing mirrors apps/files-worker/src/lib.ts (`buildOpSigningPayload`) and
 * the op field lists in apps/files-worker/src/index.ts — keep all three in
 * lockstep. The fixed test vectors in __tests__/storage/r2.test.ts and
 * apps/files-worker/src/lib.test.ts prove both runtimes produce identical
 * HMAC output.
 */

import { hmacSha256Hex } from "./r2";

export type FilesWorkerOp = "process-image" | "build-export" | "inspect";

/** Signed extra-field order per op; empty-string slots are allowed. */
const OP_PARAM_ORDER: Record<FilesWorkerOp, string[]> = {
  "process-image": ["dest", "preview"],
  "build-export": ["artifact", "name"],
  inspect: ["mode", "mb", "rtf", "fmt"],
};

// Op URLs are minted per action invocation; a short TTL bounds the replay
// window (the worker additionally rejects exps further than 15 min out).
export const FILES_OP_TTL_SECONDS = 10 * 60;

export const isFilesWorkerConfigured = (): boolean =>
  Boolean(process.env.FILES_BASE && process.env.FILES_SIGNING_SECRET);

export const buildSignedWorkerOpPayload = ({
  op,
  key,
  fields,
  exp,
}: {
  op: string;
  key: string;
  fields: string[];
  exp: string;
}): string => ["op", op, key, ...fields, exp].join("\n");

/**
 * Mint a signed op URL against the files worker. Throws when the worker is
 * not configured — gate calls behind isFilesWorkerConfigured().
 */
export const buildSignedWorkerOpUrl = async (
  spec: {
    op: FilesWorkerOp;
    /** Object key used as the request path (source key / manifest key). */
    key: string;
    params?: Record<string, string>;
  },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> => {
  const base = process.env.FILES_BASE;
  const secret = process.env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  const order = OP_PARAM_ORDER[spec.op];
  const fields = order.map((name) => spec.params?.[name] ?? "");
  const exp = String(nowSeconds + FILES_OP_TTL_SECONDS);
  const sig = await hmacSha256Hex(
    secret,
    buildSignedWorkerOpPayload({ op: spec.op, key: spec.key, fields, exp })
  );
  const url = new URL(`${base.replace(/\/+$/, "")}/${spec.key}`);
  url.searchParams.set("op", spec.op);
  order.forEach((name, index) => {
    if (fields[index]) {
      url.searchParams.set(name, fields[index] as string);
    }
  });
  url.searchParams.set("exp", exp);
  url.searchParams.set("sig", sig);
  return url.toString();
};

/**
 * - ok: the op succeeded and returned JSON
 * - fallback: a permanent client-side condition (missing source, oversized
 *   input, malformed input) — caller should use the legacy action path
 *
 * Network and 5xx responses throw so workflow retries apply.
 */
export type FilesWorkerOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "fallback" };

export const callFilesWorkerJson = async <T>(
  url: string
): Promise<FilesWorkerOutcome<T>> => {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `files_worker_network_error:${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500 || response.status === 429) {
      throw new Error(`files_worker_server_error:${response.status}`);
    }
    return { kind: "fallback" };
  }
  return { kind: "ok", data: (await response.json()) as T };
};

export interface FilesWorkerImageExif {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  latitude?: number;
  longitude?: number;
  make?: string;
  model?: string;
  /** Capture time, epoch milliseconds (when present in the file). */
  takenAt?: number;
}

export interface FilesWorkerProcessImageResult {
  exif: FilesWorkerImageExif | null;
  height: number;
  palette: string[];
  previewGenerated: boolean;
  previewKey: string | null;
  thumbhash: string | null;
  thumbnailGenerated: boolean;
  thumbnailKey: string | null;
  width: number;
}

export interface FilesWorkerBuildExportResult {
  artifactBytes: number;
  filesIncluded: number;
  filesOmitted: number;
  omittedPaths: string[];
}

export interface FilesWorkerInspectResult {
  facts?: Record<string, number>;
  text?: string;
}
