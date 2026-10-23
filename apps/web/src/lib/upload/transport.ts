import type { CardErrorCode } from "@teak/convex/shared/constants";

export type CodedUploadError = Error & { code?: CardErrorCode };

export interface UploadResponse {
  headers?: Headers | Record<string, string>;
  ok: boolean;
  status: number;
}

const UPLOAD_RETRY_DELAYS_MS = [300, 900] as const;

// A PUT that stalls (a captive portal, a dropped Wi-Fi link) never settles on
// its own, so each attempt gets a deadline: a minute, plus time to send the
// body at about 0.4 Mbit/s.
const UPLOAD_ATTEMPT_BASE_TIMEOUT_MS = 60_000;
const UPLOAD_SLOWEST_BYTES_PER_SECOND = 50_000;

export const UPLOAD_TIMED_OUT_MESSAGE =
  "The upload stopped responding. Check your connection and try again.";

export const uploadAttemptTimeoutMs = (bytes: number) =>
  UPLOAD_ATTEMPT_BASE_TIMEOUT_MS +
  Math.ceil(Math.max(0, bytes) / UPLOAD_SLOWEST_BYTES_PER_SECOND) * 1000;

const isRetriableUploadStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

const createAbortError = () => {
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

export const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

export const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw createAbortError();
  }
};

const sleep = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(createAbortError());
      },
      { once: true }
    );
  });

export const getUploadEtag = (
  headers?: Headers | Record<string, string>
): string | undefined => {
  if (!headers) {
    return;
  }
  if (headers instanceof Headers) {
    return headers.get("etag") ?? undefined;
  }
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "etag"
  );
  return entry?.[1];
};

/**
 * Runs `upload` up to three times, retrying a network error, a timeout or a
 * 408, 429 or 5xx response. Each attempt gets its own signal, which aborts
 * when `signal` does or when the attempt passes `timeoutMs`.
 */
export async function uploadWithTransientRetry(
  upload: (attemptSignal: AbortSignal) => Promise<UploadResponse>,
  signal: AbortSignal,
  { timeoutMs }: { timeoutMs?: number } = {}
): Promise<UploadResponse> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= UPLOAD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    throwIfAborted(signal);
    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort();
    signal.addEventListener("abort", abortAttempt, { once: true });
    let timedOut = false;
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            attemptController.abort();
          }, timeoutMs);
    try {
      const response = await upload(attemptController.signal);
      throwIfAborted(signal);
      if (
        response.ok ||
        !isRetriableUploadStatus(response.status) ||
        attempt === UPLOAD_RETRY_DELAYS_MS.length
      ) {
        return response;
      }
      lastError = new Error(`Upload failed with status ${response.status}`);
    } catch (error) {
      throwIfAborted(signal);
      const attemptError =
        timedOut && isAbortError(error)
          ? new Error(UPLOAD_TIMED_OUT_MESSAGE)
          : error;
      if (isAbortError(attemptError)) {
        throw attemptError;
      }
      lastError = attemptError;
      if (attempt === UPLOAD_RETRY_DELAYS_MS.length) {
        throw attemptError;
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortAttempt);
    }
    await sleep(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}
