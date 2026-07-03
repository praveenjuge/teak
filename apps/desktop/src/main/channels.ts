/**
 * Single source of truth for IPC channel names and menu event channels.
 * Shared between main process and preload to avoid duplicate allowlists.
 */

export const IPC_CHANNELS = [
  "store:read",
  "store:write",
  "shell:open-external",
  "app:get-version",
  "oauth:listen",
  "oauth:cancel",
] as const;

export const MENU_CHANNELS = [
  "desktop://menu/settings",
  "desktop://menu/logout",
] as const;

// Main -> renderer event carrying the OAuth authorization code and state once
// the loopback callback server receives the browser redirect.
export const OAUTH_CALLBACK_CHANNEL = "oauth:callback";
