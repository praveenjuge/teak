import { readFileSync } from "node:fs";
import type { SocialFetchDeps } from "../../linkMetadata/socialPostHelpers";

/** A public address the SSRF guard accepts; nothing is ever dialed. */
export const PUBLIC_ADDRESS = "93.184.216.34";

export const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

/** A recorded-shape API payload from `__tests__/linkMetadata/fixtures/social`. */
export const socialFixture = <T = any>(name: string): T =>
  JSON.parse(
    readFileSync(
      new URL(`../linkMetadata/fixtures/social/${name}`, import.meta.url),
      "utf8"
    )
  );

/**
 * Social fetch dependencies for the real `safeFetch`: DNS answers with a
 * public address (or `addresses`), and the pinned transport answers from
 * `route` (404 when it returns nothing) and records every URL it was asked.
 */
export const socialFetch = (
  route: (
    url: string,
    init: RequestInit
  ) => Response | Promise<Response> | undefined,
  { addresses = [PUBLIC_ADDRESS] }: { addresses?: string[] } = {}
) => {
  const requests: string[] = [];
  const deps: SocialFetchDeps = {
    resolveDns: async () => addresses,
    pinnedFetch: async (url, _addresses, init) => {
      requests.push(url);
      return (
        (await route(url, init)) ?? new Response("Not found", { status: 404 })
      );
    },
  };
  return { deps, requests };
};

/** A request that never answers until its signal gives up on it. */
export const hangUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(init.signal?.reason ?? new Error("aborted"))
    );
  });
