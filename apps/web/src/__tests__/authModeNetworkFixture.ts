import type { PublicAuthMode } from "@/lib/auth-mode";

export const legacyMode: PublicAuthMode = {
  primary: "betterauth",
  signupsDisabled: false,
  accountChangesPaused: false,
};

// Only the external Convex HTTP boundary is replaced. Route handlers, mode
// validation, SDK behavior, and HTTP responses remain real.
export function withAuthModeFetch(
  upstream: typeof fetch,
  mode: PublicAuthMode = legacyMode
): typeof fetch {
  return (async (input, init) => {
    if (
      String(input).endsWith("/api/query") &&
      typeof init?.body === "string"
    ) {
      const body = JSON.parse(init.body) as { path?: string };
      if (body.path === "auth:getAuthMode") {
        return Response.json({ status: "success", value: mode });
      }
    }
    return await upstream(input, init);
  }) as typeof fetch;
}
