import type { FilesOp } from "@teak/files-protocol";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";

export type FilesWorkerRenderingOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "declined"; reason: string };

/**
 * Run a Files Worker rendering operation. `declined` means the source cannot
 * be rendered (missing, too large, undecodable) or no Files Worker is set up,
 * so retrying will not help. Transient failures, including a busy or missing
 * renderer (RENDERER_UNAVAILABLE), throw so the caller's retries apply.
 */
export const runFilesWorkerRendering = async <T>(
  op: Extract<
    FilesOp,
    | "capture-screenshot"
    | "extract-animation-palette"
    | "extract-video-frame"
    | "render-pdf-thumbnail"
    | "scrape-html"
  >,
  params: Record<string, unknown>
): Promise<FilesWorkerRenderingOutcome<T>> => {
  if (!isFilesWorkerConfigured()) {
    return { kind: "declined", reason: "files_worker_not_configured" };
  }
  const outcome = await callFilesWorkerJson<T>({ op, params });
  return outcome.kind === "ok"
    ? outcome
    : {
        kind: "declined",
        reason: `${outcome.code.toLowerCase()}:${outcome.message}`,
      };
};
