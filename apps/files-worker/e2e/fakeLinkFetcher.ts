import {
  FETCHER_HOP_PATH,
  FETCHER_HOP_RESPONSE_HEADERS,
} from "../fetcher/src/protocol";

// The link fetcher Container on the E2E stack, which has no Containers. It
// answers like the missing Container (503 `container_missing`) except for a
// hop to `http://<any address>/teak-e2e-forward/<port>/<path>`, which it
// makes to `http://127.0.0.1:<port>/<path>`: a server the spec runs. The
// Worker's own checks (the URL's structure, its address, redirects) run as
// deployed; only the Container's network request is stood in for.

export const E2E_FORWARD_SEGMENT = "teak-e2e-forward";

/** The local address a forwarded hop goes to, or null for any other hop. */
export const e2eForwardTarget = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = new RegExp(
    `^/${E2E_FORWARD_SEGMENT}/(\\d{2,5})(/.*)?$`,
    "u"
  ).exec(parsed.pathname);
  if (!match) {
    return null;
  }
  return `http://127.0.0.1:${match[1]}${match[2] ?? "/"}${parsed.search}`;
};

const containerMissing = () =>
  Response.json(
    { error: "unavailable", message: "container_missing" },
    { status: 503 }
  );

export class FakeLinkFetcher {
  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== FETCHER_HOP_PATH
    ) {
      return containerMissing();
    }
    const hop = (await request.json().catch(() => null)) as {
      method?: unknown;
      url?: unknown;
    } | null;
    const target =
      typeof hop?.url === "string" ? e2eForwardTarget(hop.url) : null;
    if (!target) {
      return containerMissing();
    }
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: hop?.method === "HEAD" ? "HEAD" : "GET",
        redirect: "manual",
      });
    } catch {
      return Response.json(
        { error: "skipped", reason: "fetch_failed" },
        { status: 422 }
      );
    }
    await upstream.body?.cancel().catch(() => undefined);
    const headers = new Headers({
      [FETCHER_HOP_RESPONSE_HEADERS.status]: String(upstream.status),
    });
    const location = upstream.headers.get("location");
    if (location) {
      headers.set(FETCHER_HOP_RESPONSE_HEADERS.location, location);
    }
    return new Response(null, { headers, status: 200 });
  }
}
