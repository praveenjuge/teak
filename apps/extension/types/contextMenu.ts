export const RECENT_CONTEXT_MENU_SAVE_MS = 5000;

export type ContextMenuAction = "save-asset" | "save-page" | "save-text";

export interface ContextMenuSaveState {
  action?: ContextMenuAction;
  code?: string;
  content?: string;
  error?: string;
  status: "idle" | "saving" | "success" | "duplicate" | "error";
  timestamp?: number;
}
