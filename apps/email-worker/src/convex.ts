import {
  FINALIZE_PATH,
  INGEST_PATH,
  type InboundEmailPayload,
  signedHeaders,
} from "./payload";
import type { Deps } from "./types";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Signed requests to Convex. A message is retried a few times here; when
// Convex still can't take it, the handler throws so the sending server tries
// again later (Email Routing tells it to). Convex keeps a receipt per message,
// so a retry never saves it twice.

/** Waits between the three tries of a message. */
export const INGEST_RETRY_DELAYS_MS = [1000, 3000];
export const FINALIZE_RETRY_DELAYS_MS = [1000];

export interface PlannedUpload {
  fileKey: string;
  index: number;
  uploadUrl: string;
}

export type IngestResult =
  | {
      kind: "accepted";
      receiptKey: string | null;
      status: string;
      uploads: PlannedUpload[];
    }
  | { kind: "unknown_sender" };

export interface ConvexTarget {
  secret: string;
  siteUrl: string;
}

export class DeliveryError extends Error {}

const post = async (
  deps: Deps,
  target: ConvexTarget,
  path: string,
  body: string
): Promise<Response> =>
  deps.fetch(new URL(path, target.siteUrl).toString(), {
    body,
    headers: await signedHeaders(target.secret, path, body, deps.now()),
    method: "POST",
  });

const readJson = async (response: Response): Promise<unknown> =>
  await response.json().catch(() => null);

const isUpload = (value: unknown): value is PlannedUpload => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { fileKey, index, uploadUrl } = value as Record<string, unknown>;
  if (
    !(
      typeof fileKey === "string" &&
      typeof uploadUrl === "string" &&
      typeof index === "number" &&
      Number.isSafeInteger(index)
    )
  ) {
    return false;
  }
  try {
    const url = new URL(uploadUrl);
    // Plain http only to this machine: the local E2E stack's Files Worker.
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
    );
  } catch {
    return false;
  }
};

/** Convex's answer for a saved message. An old backend sends no uploads. */
const acceptedResult = (body: unknown): IngestResult => {
  const record = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const receiptKey =
    typeof record.receiptKey === "string" && record.receiptKey
      ? record.receiptKey
      : null;
  return {
    kind: "accepted",
    receiptKey,
    status: typeof record.status === "string" ? record.status : "saved",
    uploads:
      receiptKey && Array.isArray(record.uploads)
        ? record.uploads.filter(isUpload)
        : [],
  };
};

export const ingestEmail = async (
  deps: Deps,
  target: ConvexTarget,
  payload: InboundEmailPayload
): Promise<IngestResult> => {
  const body = JSON.stringify(payload);
  let lastProblem = "convex_unreachable";
  for (let attempt = 0; attempt <= INGEST_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await deps.sleep(INGEST_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    let response: Response;
    try {
      response = await post(deps, target, INGEST_PATH, body);
    } catch {
      lastProblem = "convex_unreachable";
      continue;
    }
    if (response.status === 200) {
      return acceptedResult(await readJson(response));
    }
    if (response.status === 404) {
      const answer = (await readJson(response)) as { error?: unknown } | null;
      if (answer?.error === "unknown_sender") {
        return { kind: "unknown_sender" };
      }
      throw new DeliveryError("convex_status_404");
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 500) {
      lastProblem = `convex_status_${response.status}`;
      continue;
    }
    // A signing or configuration fault: the sender retries later, once fixed.
    throw new DeliveryError(`convex_status_${response.status}`);
  }
  throw new DeliveryError(lastProblem);
};

export const finalizeAttachment = async (
  deps: Deps,
  target: ConvexTarget,
  request: { fileKey: string; index: number; receiptKey: string; size: number }
): Promise<string> => {
  const body = JSON.stringify({ v: 1, ...request });
  let outcome = "unreachable";
  for (let attempt = 0; attempt <= FINALIZE_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await deps.sleep(FINALIZE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
    }
    let response: Response;
    try {
      response = await post(deps, target, FINALIZE_PATH, body);
    } catch {
      outcome = "unreachable";
      continue;
    }
    if (response.status === 200 || response.status === 202) {
      const answer = (await readJson(response)) as { status?: unknown } | null;
      return typeof answer?.status === "string" ? answer.status : "saved";
    }
    await response.body?.cancel().catch(() => undefined);
    outcome = `status_${response.status}`;
    if (response.status < 500) {
      return outcome;
    }
  }
  return outcome;
};
