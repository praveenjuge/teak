import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

// Kept apart from folder/rules.ts, which imports folder/folders.ts: the
// folder validators here load before either.

export interface FolderRules {
  autoFile: { enabled: boolean; query: string } | null;
  autoTags: string[];
}

export const folderRulesValidator = v.object({
  autoTags: v.array(v.string()),
  autoFile: v.union(
    v.object({ query: v.string(), enabled: v.boolean() }),
    v.null()
  ),
});

export const folderRulesOf = (
  folder: Pick<Doc<"folders">, "autoFilePaused" | "autoFileQuery" | "autoTags">
): FolderRules => ({
  autoTags: folder.autoTags ?? [],
  autoFile:
    folder.autoFileQuery === undefined
      ? null
      : {
          query: folder.autoFileQuery,
          enabled: folder.autoFilePaused !== true,
        },
});
