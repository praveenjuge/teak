import { SESSION_HINT_COOKIE } from "@teak/convex/shared/sessionHint";

export const WEB_APP_URL = "https://app.teakvault.com";
// Link straight to the routes that start AuthKit: `/login` and `/register`
// only redirect to these.
export const SIGN_IN_URL = `${WEB_APP_URL}/sign-in`;
export const SIGN_UP_URL = `${WEB_APP_URL}/sign-up`;

// Hosts a click on a sign-in link reaches, in order: the app starts AuthKit,
// WorkOS authorizes, and the hosted sign-in page loads.
export const SIGN_IN_ORIGINS = [
  WEB_APP_URL,
  "https://api.workos.com",
  "https://scholarly-hay-77.authkit.app",
];

/**
 * Runs just before the site header (components/Header.astro), so a signed-in
 * visitor never sees Login and Register flash before "Open Teak". The app
 * keeps the cookie on teakvault.com; it is a hint only, and a stale one costs
 * one redirect.
 *
 * - Marks <html data-signed-in> for the header's own CSS, which hides
 *   `[data-signed-out-only]` or `[data-signed-in-only]`.
 * - Points sign-up and sign-in links (`a[data-app-entry]`) at the app itself,
 *   or at the page a link names in `data-signed-in-href`.
 * - Opens connections to the sign-in hosts when a pointer or focus reaches
 *   one of those links, so the click doesn't wait on DNS and TLS.
 */
export function appEntryScript(
  signedInUrl = `${WEB_APP_URL}/`,
  origins = SIGN_IN_ORIGINS
) {
  return `(() => {
  const signedIn = document.cookie
    .split(";")
    .some((pair) => pair.trim() === ${JSON.stringify(`${SESSION_HINT_COOKIE}=1`)});
  if (signedIn) {
    document.documentElement.dataset.signedIn = "";
    document.addEventListener("DOMContentLoaded", () => {
      for (const link of document.querySelectorAll("a[data-app-entry]")) {
        link.href = link.dataset?.signedInHref || ${JSON.stringify(signedInUrl)};
      }
    });
  }
  const origins = signedIn ? [${JSON.stringify(signedInUrl)}] : ${JSON.stringify(origins)};
  let warmed = false;
  const warm = (event) => {
    if (warmed || !event.target.closest?.("a[data-app-entry]")) {
      return;
    }
    warmed = true;
    for (const origin of origins) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = new URL(origin).origin;
      document.head.append(link);
    }
  };
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("focusin", warm);
})();`;
}
