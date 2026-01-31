export type ContextMenuAction = "save-page" | "save-text";

export interface ContextMenuSaveState {
  action?: ContextMenuAction;
  timestamp?: number;
  status: "idle" | "saving" | "success" | "error";
  error?: string;
  content?: string; // Content to be saved (internal use)
}
