// Shared by the sidebar, the session loader on the server and the pre-paint
// script in the root route, so none of them pulls in the sidebar's UI.
export const SIDEBAR_COOKIE_NAME = "sidebar_state";
export const SIDEBAR_WIDTH_COOKIE_NAME = "sidebar_width";

export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 288;

export const sidebarOpenFromCookie = (value: string | undefined): boolean =>
  value !== "false";

export const clampSidebarWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));

export const sidebarWidthFromCookie = (value: string | undefined): number => {
  const width = Number.parseInt(value ?? "", 10);
  return Number.isFinite(width)
    ? clampSidebarWidth(width)
    : SIDEBAR_DEFAULT_WIDTH;
};
