/**
 * Single source of truth for IPC channel names and menu event channels.
 * Shared between main process and preload to avoid duplicate allowlists.
 */

export const IPC_CHANNELS = [
  "store:read",
  "store:write",
  "shell:open-external",
  "app:get-version",
] as const;

export const MENU_CHANNELS = [
  "desktop://menu/settings",
  "desktop://menu/logout",
] as const;
