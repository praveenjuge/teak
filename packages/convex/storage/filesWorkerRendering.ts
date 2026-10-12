import type { FilesOp } from "@teak/files-protocol";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";

/**
 * Run a Files Worker rendering operation, or return null so the caller keeps
 * its previous (Kernel) renderer. Null covers an unconfigured worker, a worker
 * deployment without the operation or its Browser Run/Media binding, sources
 * outside the operation's limits, and transient failures.
 */
export const tryFilesWorkerRendering = async <T>(
  op: Extract<
    FilesOp,
    | "capture-screenshot"
    | "extract-video-frame"
    | "render-pdf-thumbnail"
    | "scrape-html"
  >,
  params: Record<string, unknown>,
  logPrefix: string
): Promise<T | null> => {
  if (!isFilesWorkerConfigured()) {
    return null;
  }
  try {
    const outcome = await callFilesWorkerJson<T>({ op, params });
    if (outcome.kind === "ok") {
      return outcome.data;
    }
    console.log(`${logPrefix} Files Worker declined ${op}; using Kernel`);
  } catch (error) {
    console.warn(`${logPrefix} Files Worker ${op} failed; using Kernel`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
};
