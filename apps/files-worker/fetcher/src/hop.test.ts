import { describe, expect, test } from "bun:test";
import type { PinnedFetch } from "../../../../packages/convex/linkMetadata/ssrf";
import { createFetcherHandler } from "./handler";
import { FETCHER_HOP_RESPONSE_HEADERS } from "./protocol";

const PUBLIC = "93.184.216.34";

const setup = (respond: (url: string) => Response) => {
  const calls: { addresses: string[]; init: RequestInit; url: string }[] = [];
  const pinnedFetch: PinnedFetch = (url, addresses, init) => {
    calls.push({ addresses, init, url });
    return Promise.resolve(respond(url));
  };
  const handle = createFetcherHandler({
    pinnedFetch,
    resolveDns: () => Promise.reject(new Error("unexpected lookup")),
  });
  const hop = (body: Record<string, unknown>) =>
    handle(
      new Request("http://fetcher/hop", {
        body: JSON.stringify({
          addresses: [PUBLIC],
          headers: { accept: "application/json" },
          maxBytes: 1024,
          timeoutMs: 10_000,
          url: "https://api.example/post.json",
          ...body,
        }),
        method: "POST",
      })
    );
  return { calls, hop };
};

describe("fetcher hop", () => {
  test("returns the upstream status, headers and body from the checked address", async () => {
    const { calls, hop } = setup(
      () =>
        new Response('{"ok":true}', {
          headers: { "content-type": "application/json" },
          status: 200,
        })
    );
    const response = await hop({});
    expect(response.status).toBe(200);
    expect(response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.status)).toBe(
      "200"
    );
    expect(response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.contentType)).toBe(
      "application/json"
    );
    expect(await response.text()).toBe('{"ok":true}');
    expect(calls.map(({ addresses, url }) => ({ addresses, url }))).toEqual([
      { addresses: [PUBLIC], url: "https://api.example/post.json" },
    ]);
    expect(new Headers(calls[0]?.init.headers).get("accept")).toBe(
      "application/json"
    );
  });

  test.each([
    ["a private address", { addresses: ["10.0.0.5"] }],
    [
      "a metadata address beside a public one",
      { addresses: [PUBLIC, "169.254.169.254"] },
    ],
    ["an IPv4-mapped loopback", { addresses: ["::ffff:127.0.0.1"] }],
    ["a private literal host", { url: "http://192.168.1.1/admin" }],
    ["a non-web port", { url: "https://api.example:8443/x" }],
  ])("refuses %s without connecting", async (_name, body) => {
    const { calls, hop } = setup(() => new Response("secret"));
    const response = await hop(body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "skipped",
      reason: "blocked_url",
    });
    expect(calls).toEqual([]);
  });

  test("returns a redirect as it is, without following it", async () => {
    const { calls, hop } = setup(() =>
      Response.redirect("http://169.254.169.254/latest", 302)
    );
    const response = await hop({});
    expect(response.status).toBe(200);
    expect(response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.status)).toBe(
      "302"
    );
    expect(response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.location)).toBe(
      "http://169.254.169.254/latest"
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  test("returns at most one byte past the cap, so the caller sees the overflow", async () => {
    const { hop } = setup(() => new Response(new Uint8Array(5000).fill(65)));
    const response = await hop({ maxBytes: 10 });
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(11);
  });

  test("refuses request headers outside the allowlist", async () => {
    const { calls, hop } = setup(() => new Response("ok"));
    const response = await hop({ headers: { cookie: "session=1" } });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("reports a connection failure as fetch_failed", async () => {
    const { hop } = setup(() => {
      throw new TypeError("fetch failed");
    });
    const response = await hop({});
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "skipped",
      reason: "fetch_failed",
    });
  });
});
