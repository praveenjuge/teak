// Shared by the sidebar (client) and the app layout (server), so it lives
// outside the "use client" sidebar module: a server component importing a
// value from a client module gets a client reference, not the string.
export const SIDEBAR_COOKIE_NAME = "sidebar_state";
/** The desktop sidebar's width in pixels, set by dragging its edge. */
export const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width";

export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 288;

/** The desktop sidebar opens unless the cookie remembers it collapsed. */
export const sidebarOpenFromCookie = (value: string | undefined): boolean =>
  value !== "false";

/** Keeps a dragged width within the sidebar's bounds, in whole pixels. */
export const clampSidebarWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));

/** The remembered width, or the default when the cookie is missing or bad. */
export const sidebarWidthFromCookie = (value: string | undefined): number => {
  const width = Number.parseInt(value ?? "", 10);
  return Number.isFinite(width)
    ? clampSidebarWidth(width)
    : SIDEBAR_DEFAULT_WIDTH;
};
