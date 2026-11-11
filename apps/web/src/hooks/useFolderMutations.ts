import { api } from "@teak/convex";
import type { OptimisticUpdate } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useMemo } from "react";
import type { FolderSummary } from "../lib/folders";

/**
 * The web app's only bindings of the folder mutations. A rename, a color or
 * a delete shows in every folder list before the server answers.
 */

const updateFolderLocally: OptimisticUpdate<
  FunctionArgs<typeof api.folders.updateFolder>
> = (localStore, { color, folderId, name }) => {
  const current = localStore.getQuery(api.folders.listFolders, {});
  if (!current || (color === undefined && name === undefined)) {
    return;
  }
  localStore.setQuery(
    api.folders.listFolders,
    {},
    current.map((folder: FolderSummary) =>
      folder._id === folderId
        ? {
            ...folder,
            ...(color === undefined ? {} : { color: color ?? undefined }),
            ...(name === undefined ? {} : { name: name.trim() }),
          }
        : folder
    )
  );
};

const deleteFolderLocally: OptimisticUpdate<
  FunctionArgs<typeof api.folders.deleteFolder>
> = (localStore, { folderId }) => {
  const current = localStore.getQuery(api.folders.listFolders, {});
  if (current) {
    localStore.setQuery(
      api.folders.listFolders,
      {},
      current.filter((folder: FolderSummary) => folder._id !== folderId)
    );
  }
};

export const useCreateFolder = () => useMutation(api.folders.createFolder);

export const useUpdateFolder = () => {
  const run = useMutation(api.folders.updateFolder);
  return useMemo(() => run.withOptimisticUpdate(updateFolderLocally), [run]);
};

export const useDeleteFolder = () => {
  const run = useMutation(api.folders.deleteFolder);
  return useMemo(() => run.withOptimisticUpdate(deleteFolderLocally), [run]);
};

export const useRestoreFolder = () => useMutation(api.folders.restoreFolder);
