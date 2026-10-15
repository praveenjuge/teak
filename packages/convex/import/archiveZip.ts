import type {
  FilesImportIndexParams,
  FilesImportIndexResult,
  FilesImportMarkdownResult,
} from "@teak/files-protocol";
import { IMPORT_FAILURE } from "../shared/importSources";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { assertR2KeyInNamespace } from "../storage/r2";

/** File bytes and parsing stay in the worker; Convex consumes bounded facts. */
export async function readImportIndexPage(
  params: FilesImportIndexParams
): Promise<FilesImportIndexResult> {
  assertR2KeyInNamespace(params.sourceKey);
  const outcome = await callFilesWorkerJson<FilesImportIndexResult>({
    op: "index-import-source",
    params: { ...params },
    fallbackCodes: ["INVALID_INPUT"],
  });
  if (outcome.kind !== "ok") {
    if (outcome.code === "INVALID_INPUT") {
      throw new Error(
        /_count$/.test(outcome.message)
          ? IMPORT_FAILURE.TOO_MANY_ITEMS
          : IMPORT_FAILURE.INVALID_SOURCE
      );
    }
    throw new Error("import_source_unavailable");
  }
  return outcome.data;
}

export async function readLegacyMarkdown(
  sourceKey: string,
  sourceEtag: string,
  path: string
): Promise<FilesImportMarkdownResult> {
  assertR2KeyInNamespace(sourceKey);
  const outcome = await callFilesWorkerJson<FilesImportMarkdownResult>({
    op: "read-import-markdown",
    params: { sourceKey, sourceEtag, path },
  });
  if (outcome.kind !== "ok") {
    throw new Error("markdown_source_unavailable");
  }
  return outcome.data;
}
