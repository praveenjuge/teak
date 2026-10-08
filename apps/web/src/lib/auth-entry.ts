import { getSafeNextPath } from "./safe-next-path";

const ENTRY_FLOWS: Record<string, "signin" | "signup" | "recovery"> = {
  "/login": "signin",
  "/register": "signup",
  "/forgot-password": "recovery",
  "/reset-password": "recovery",
};

// WorkOS hosts sign-in, sign-up and password recovery, so Teak's entry pages
// never render under WorkOS: signed-in visitors go to their destination and
// everyone else goes straight to hosted AuthKit.
export function workosEntryRedirect(
  url: Pick<URL, "origin" | "pathname" | "searchParams">,
  signedIn: boolean
): URL | null {
  const flow = ENTRY_FLOWS[url.pathname];
  if (!flow) {
    return null;
  }
  const next = getSafeNextPath(url.searchParams.get("next"));
  if (signedIn) {
    return new URL(next ?? "/", url.origin);
  }
  const target = new URL(
    flow === "signup" ? "/sign-up" : "/sign-in",
    url.origin
  );
  if (next) {
    target.searchParams.set("next", next);
  }
  return target;
}
