import { getSafeNextPath } from "./safe-next-path";

const ENTRY_FLOWS: Record<string, "signin" | "signup" | "recovery"> = {
  "/login": "signin",
  "/register": "signup",
  "/forgot-password": "recovery",
  "/reset-password": "recovery",
};

const SIGN_IN_ROUTES = new Set(["/sign-in", "/sign-up"]);

export function workosEntryRedirect(
  url: Pick<URL, "origin" | "pathname" | "searchParams">,
  signedIn: boolean
): URL | null {
  const next = getSafeNextPath(url.searchParams.get("next"));
  // A signed-in visit to sign-in would only bounce through AuthKit and back.
  // After a failed callback (`reauth`) the visitor asked to sign in again.
  if (SIGN_IN_ROUTES.has(url.pathname)) {
    return signedIn && !url.searchParams.has("reauth")
      ? new URL(next ?? "/", url.origin)
      : null;
  }
  const flow = ENTRY_FLOWS[url.pathname];
  if (!flow) {
    return null;
  }
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
