// A non-secret "this browser is signed in to Teak" flag the web app keeps on
// its parent domain, so teakvault.com can link signed-in visitors straight
// into the app instead of through sign-in. It never grants access: the app
// checks the real session on every request, and a stale hint costs one
// redirect to sign-in.

export const SESSION_HINT_COOKIE = "teak_session_hint";

// The app renews the hint on any page load that finds it missing, so this
// only needs to outlast a normal gap between visits.
export const SESSION_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The domain to share the hint with: `app.teakvault.com` shares it with
 * `teakvault.com` and its subdomains. Any other host (localhost, preview
 * deployments) keeps it host-only.
 */
export function sessionHintDomain(hostname: string): string | undefined {
  const labels = hostname.toLowerCase().split(".");
  return labels[0] === "app" && labels.length >= 3
    ? labels.slice(1).join(".")
    : undefined;
}
