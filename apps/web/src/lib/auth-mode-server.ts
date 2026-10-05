import "server-only";
import { api } from "@teak/convex";
import { ConvexHttpClient } from "convex/browser";
import { type PublicAuthMode, validateAuthMode } from "./auth-mode";
import { getConvexUrl } from "./public-env";

export async function readAuthMode(): Promise<PublicAuthMode> {
  const backend = getConvexUrl();
  const endpoint = new URL("/api/query", backend).toString();
  const client = new ConvexHttpClient(backend, {
    fetch: ((input, init) => {
      if (typeof input !== "string" || input !== endpoint) {
        throw new Error("Unexpected authentication configuration endpoint.");
      }
      return fetch(endpoint, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    }) as typeof fetch,
  });
  return validateAuthMode(await client.query(api.auth.getAuthMode, {}));
}

// Proxy instances may cache only optimistic routing decisions, never credentials.
let cached:
  | { url: string; mode: PublicAuthMode; expiresAt: number }
  | undefined;
export async function readProxyAuthMode(): Promise<PublicAuthMode> {
  const url = getConvexUrl();
  if (cached?.url === url && cached.expiresAt > Date.now()) {
    return cached.mode;
  }
  const mode = await readAuthMode();
  cached = { url, mode, expiresAt: Date.now() + 30_000 };
  return mode;
}
