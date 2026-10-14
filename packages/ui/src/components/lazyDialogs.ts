import { onDemand } from "../lib/lazyWithPreload";

// Dialogs the library opens only on request. Their code loads after the
// page (see `preloadLibraryDialogs`), not with it.

export const BulkTagsDialog = onDemand(() =>
  import("./selection/BulkTagsDialog").then((module) => module.BulkTagsDialog)
);

export const CardFoldersDialog = onDemand(() =>
  import("./folders/CardFoldersDialog").then(
    (module) => module.CardFoldersDialog
  )
);

export const FolderNameDialog = onDemand(() =>
  import("./folders/FolderNameDialog").then((module) => module.FolderNameDialog)
);

export const FolderPickerDialog = onDemand(() =>
  import("./folders/FolderPickerDialog").then(
    (module) => module.FolderPickerDialog
  )
);

export const FullScreenAddCardDialog = onDemand(() =>
  import("./forms/FullScreenAddCardDialog").then(
    (module) => module.FullScreenAddCardDialog
  )
);

export const TagManagementModal = onDemand(() =>
  import("./modals/TagManagementModal").then(
    (module) => module.TagManagementModal
  )
);

/** Loads every library dialog, so the first open of each is instant. */
export function preloadLibraryDialogs(): Promise<unknown> {
  return Promise.all(
    [
      BulkTagsDialog,
      CardFoldersDialog,
      FolderNameDialog,
      FolderPickerDialog,
      FullScreenAddCardDialog,
      TagManagementModal,
    ].map((dialog) => dialog.preload())
  );
}
