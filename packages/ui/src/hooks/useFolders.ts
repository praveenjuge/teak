import { api } from "@teak/convex";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { FolderSummary } from "../lib/folders";

export function useFolders(): FolderSummary[] | undefined {
  return useQuery(api.folders.listFolders, {});
}
