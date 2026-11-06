import {
  type FilesEnvelope,
  type FilesErrorCode,
  type FilesNetworkOp,
  type FilesOpOutcome,
  nowInSeconds,
  readFilesOpOutcome,
  SIGNED_REQUEST_HEADERS,
  type SignedOpRequest,
  type SignedUploadUrl,
  signFilesOpRequest,
  signMultipartPartUrl,
  signUploadUrl,
} from "@teak/files-protocol";
import { env } from "../_generated/server";
import { assertR2KeyInNamespace } from "./r2Keys";

export const STORE_LINKED_PDF_TIMEOUT_MS = 150_000;

const DEFAULT_OP_TIMEOUT_MS = 120_000;

const OP_TIMEOUT_MS: Partial<Record<FilesNetworkOp, number>> = {
  dispatch: 60_000,
  "embed-upsert": 60_000,
  "store-linked-pdf": STORE_LINKED_PDF_TIMEOUT_MS,
  "vector-delete": 30_000,
  "vector-query": 30_000,
  "vector-similar": 30_000,
};

export const isCoreWorkerConfigured = (): boolean =>
  Boolean(env.FILES_BASE && env.FILES_SIGNING_SECRET);

const coreWorker = (): { base: string; secret: string } => {
  const base = env.FILES_BASE;
  const secret = env.FILES_SIGNING_SECRET;
  if (!(base && secret)) {
    throw new Error("files_worker_not_configured");
  }
  return { base, secret };
};

export const signedUploadUrl = async (
  args: {
    contentType: string | null;
    key: string;
    size?: number | null;
    ttlSeconds?: number;
  },
  nowSeconds = nowInSeconds()
): Promise<SignedUploadUrl> => {
  const worker = coreWorker();
  assertR2KeyInNamespace(args.key);
  return await signUploadUrl({ ...worker, ...args }, nowSeconds);
};

export const putObjectViaCoreWorker = async ({
  body,
  contentType,
  key,
  signal,
}: {
  body: Blob | ArrayBuffer | Uint8Array;
  contentType: string;
  key: string;
  signal?: AbortSignal;
}): Promise<{ etag: string; key: string; size: number }> => {
  const signed = await signedUploadUrl({
    contentType: contentType || null,
    key,
  });
  // The URL is FILES_BASE, the deployment's own Core Worker, plus a fixed route.
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  const response = await fetch(signed.url, {
    body: body instanceof Uint8Array ? new Uint8Array(body) : body,
    headers: {
      "content-type": contentType,
      [SIGNED_REQUEST_HEADERS.requestId]: crypto.randomUUID(),
    },
    method: "PUT",
    signal,
  });
  const envelope = (await response.json().catch(() => null)) as FilesEnvelope<{
    etag: string;
    key: string;
    size: number;
  }> | null;
  if (!(response.ok && envelope?.ok)) {
    throw new Error(`files_worker_upload_error:${response.status}`);
  }
  return envelope.data;
};

export const signedMultipartPartUrl = async (
  args: {
    key: string;
    partNumber: number;
    size?: number | null;
    ttlSeconds?: number;
    uploadId: string;
  },
  nowSeconds = nowInSeconds()
): Promise<string> => {
  const worker = coreWorker();
  assertR2KeyInNamespace(args.key);
  return await signMultipartPartUrl({ ...worker, ...args }, nowSeconds);
};

export const signedOpRequest = async (
  spec: { op: FilesNetworkOp; params: Record<string, unknown> },
  nowSeconds = nowInSeconds()
): Promise<SignedOpRequest> =>
  await signFilesOpRequest({ ...coreWorker(), ...spec }, nowSeconds);

/**
 * Runs one op on the Core Worker. Network failures and every answer that
 * is neither a result nor a decline throw, so the caller's retries apply.
 */
export const callCoreWorkerOp = async <T>(spec: {
  declineCodes?: readonly FilesErrorCode[];
  op: FilesNetworkOp;
  params: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<FilesOpOutcome<T>> => {
  const signed = await signedOpRequest(spec);
  let response: Response;
  try {
    // The URL is FILES_BASE, the deployment's own Core Worker, plus a fixed route.
    // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
    response = await fetch(signed.url, {
      ...signed,
      redirect: "error",
      signal: AbortSignal.timeout(
        spec.timeoutMs ?? OP_TIMEOUT_MS[spec.op] ?? DEFAULT_OP_TIMEOUT_MS
      ),
    });
  } catch (error) {
    throw new Error(
      `files_worker_network_error:${error instanceof Error ? error.message : String(error)}`
    );
  }
  const envelope = (await response
    .json()
    .catch(() => null)) as FilesEnvelope<T> | null;
  return readFilesOpOutcome(envelope, response.status, spec.declineCodes);
};
