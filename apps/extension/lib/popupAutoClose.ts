export type FileUploadState = "error" | "idle" | "saving" | "success";

interface PopupAutoCloseState {
  fileUploadState: FileUploadState;
  isAutoSaveSuccess: boolean;
  isContextMenuSuccess: boolean;
}

export function shouldAutoClosePopup({
  fileUploadState,
  isAutoSaveSuccess,
  isContextMenuSuccess,
}: PopupAutoCloseState): boolean {
  if (fileUploadState !== "idle") {
    return fileUploadState === "success";
  }

  return isAutoSaveSuccess || isContextMenuSuccess;
}
