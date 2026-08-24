import type { CardErrorCode } from "../../shared/constants";

export type CodedUploadError = Error & { code?: CardErrorCode };

export interface UploadResponse {
  headers?: Headers | Record<string, string>;
  ok: boolean;
  status: number;
}

const UPLOAD_RETRY_DELAYS_MS = [300, 900] as const;

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

export async function uploadWithTransientRetry(
  upload: () => Promise<UploadResponse>,
  signal: AbortSignal
): Promise<UploadResponse> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= UPLOAD_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    throwIfAborted(signal);
    try {
      const response = await upload();
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
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      if (attempt === UPLOAD_RETRY_DELAYS_MS.length) {
        throw error;
      }
    }
    await sleep(UPLOAD_RETRY_DELAYS_MS[attempt], signal);
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed");
}
