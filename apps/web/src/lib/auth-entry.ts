import { getSafeNextPath } from "./safe-next-path";

const ENTRY_FLOWS: Record<string, "signin" | "signup" | "recovery"> = {
  "/login": "signin",
  "/register": "signup",
  "/forgot-password": "recovery",
  "/reset-password": "recovery",
};

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
