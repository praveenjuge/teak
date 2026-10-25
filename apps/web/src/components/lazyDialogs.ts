import { onDemand } from "../lib/lazyWithPreload";

export const BulkTagsDialog = onDemand(() =>
  import("./selection/BulkTagsDialog").then((module) => module.BulkTagsDialog)
);

export const CardFoldersDialog = onDemand(() =>
  import("./folders/CardFoldersDialog").then(
    (module) => module.CardFoldersDialog
  )
);

export const EditLinkDialog = onDemand(() =>
  import("./cards/EditLinkDialog").then((module) => module.EditLinkDialog)
);

export const FolderNameDialog = onDemand(() =>
  import("./folders/FolderNameDialog").then((module) => module.FolderNameDialog)
);

export const FolderPickerDialog = onDemand(() =>
  import("./folders/FolderPickerDialog").then(
    (module) => module.FolderPickerDialog
  )
);

export const FocusEditor = onDemand(() =>
  import("./text-editor/FocusEditor").then((module) => module.FocusEditor)
);

export const TagManagementModal = onDemand(() =>
  import("./modals/TagManagementModal").then(
    (module) => module.TagManagementModal
  )
);

export function preloadLibraryDialogs(): Promise<unknown> {
  return Promise.all(
    [
      BulkTagsDialog,
      CardFoldersDialog,
      EditLinkDialog,
      FolderNameDialog,
      FolderPickerDialog,
      FocusEditor,
      TagManagementModal,
    ].map((dialog) => dialog.preload())
  );
}
