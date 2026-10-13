// Shared by the sidebar (client) and the app layout (server), so it lives
// outside the "use client" sidebar module: a server component importing a
// value from a client module gets a client reference, not the string.
export const SIDEBAR_COOKIE_NAME = "sidebar_state";

/** The desktop sidebar opens unless the cookie remembers it collapsed. */
export const sidebarOpenFromCookie = (value: string | undefined): boolean =>
  value !== "false";
