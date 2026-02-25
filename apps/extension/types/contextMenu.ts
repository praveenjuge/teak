export type ContextMenuAction = "save-page" | "save-text";

export interface ContextMenuSaveState {
  action?: ContextMenuAction;
  content?: string; // Content to be saved (internal use)
  error?: string;
  status: "idle" | "saving" | "success" | "error";
  timestamp?: number;
}
