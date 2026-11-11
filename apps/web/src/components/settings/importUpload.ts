import type { api } from "@teak/convex";
import type { FunctionReturnType } from "convex/server";
import {
  getUploadEtag,
  isAbortError,
  throwIfAborted,
  uploadAttemptTimeoutMs,
  uploadWithTransientRetry,
} from "@/lib/upload/transport";

const UPLOAD_CONCURRENCY = 3;

/** The parts still to send, as `createImportUpload` plans them. */
export type UploadPlan = Omit<
  FunctionReturnType<typeof api.importUpload.createImportUpload>,
  "jobId"
>;

export interface UploadedPart {
  etag: string;
  partNumber: number;
  size: number;
}

/**
 * Sends an import file's remaining parts, three at a time, and records each
 * one as it lands. The first failure stops the rest.
 */
export async function putParts(
  file: File,
  plan: UploadPlan,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  recordPart: (part: UploadedPart) => Promise<unknown>
) {
  throwIfAborted(signal);
  const totalBytes = Math.max(file.size, 1);
  let uploadedBytes = plan.uploadedParts.reduce((total, partNumber) => {
    const start = (partNumber - 1) * plan.partSize;
    return total + Math.min(plan.partSize, file.size - start);
  }, 0);
  onProgress(Math.round((uploadedBytes / totalBytes) * 100));
  const stop = new AbortController();
  const stopAll = () => stop.abort();
  signal.addEventListener("abort", stopAll, { once: true });
  const uploadPart = async (part: UploadPlan["parts"][number]) => {
    const start = (part.partNumber - 1) * plan.partSize;
    const chunk = file.slice(start, Math.min(start + plan.partSize, file.size));
    const response = await uploadWithTransientRetry(
      (attemptSignal) =>
        fetch(part.url, { body: chunk, method: "PUT", signal: attemptSignal }),
      stop.signal,
      { timeoutMs: uploadAttemptTimeoutMs(chunk.size) }
    );
    if (!response.ok) {
      throw new Error(
        `Upload part ${part.partNumber} failed (${response.status})`
      );
    }
    const etag = getUploadEtag(response.headers);
    if (!etag) {
      throw new Error(`Upload part ${part.partNumber} returned no ETag`);
    }
    await recordPart({ etag, partNumber: part.partNumber, size: chunk.size });
    uploadedBytes += chunk.size;
    onProgress(Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)));
  };
  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      const part = stop.signal.aborted ? undefined : plan.parts[nextIndex];
      nextIndex += 1;
      if (!part) {
        return;
      }
      try {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await uploadPart(part);
      } catch (error) {
        stop.abort();
        throw error;
      }
    }
  };
  try {
    const settled = await Promise.allSettled(
      Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, plan.parts.length) },
        worker
      )
    );
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length > 0) {
      throw failures.find((error) => !isAbortError(error)) ?? failures[0];
    }
  } finally {
    signal.removeEventListener("abort", stopAll);
  }
}
