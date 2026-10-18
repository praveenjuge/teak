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
  const send = (path: string, body: Record<string, unknown>) =>
    handle(
      new Request(`http://fetcher${path}`, {
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
  const hop = (body: Record<string, unknown>) => send("/hop", body);
  const stream = (body: Record<string, unknown>) => send("/hop-stream", body);
  return { calls, hop, stream };
};

const MiB = 1024 * 1024;

/** An upstream body of `chunks` 1 MiB pieces that records a cancel. */
const upstream = (chunks: number) => {
  const state = { cancelled: false, pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      state.cancelled = true;
    },
    pull(controller) {
      if (state.pulled === chunks) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new Uint8Array(MiB).fill(state.pulled));
    },
  });
  return { body, state };
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

describe("fetcher streamed hop", () => {
  test("streams a body larger than a buffered hop may carry", async () => {
    const { hop, stream } = setup(
      () =>
        new Response(upstream(6).body, {
          headers: { "content-type": "audio/mpeg" },
        })
    );
    expect((await hop({ maxBytes: 10 * MiB })).status).toBe(400);

    const response = await stream({ maxBytes: 10 * MiB });
    expect(response.status).toBe(200);
    expect(response.headers.get(FETCHER_HOP_RESPONSE_HEADERS.contentType)).toBe(
      "audio/mpeg"
    );
    expect((await response.arrayBuffer()).byteLength).toBe(6 * MiB);
  });

  test("stops one byte past the cap and cancels the upstream", async () => {
    const source = upstream(50);
    const { stream } = setup(() => new Response(source.body));
    const response = await stream({ maxBytes: 2 * MiB });
    expect((await response.arrayBuffer()).byteLength).toBe(2 * MiB + 1);
    expect(source.state.cancelled).toBe(true);
    expect(source.state.pulled).toBeLessThan(50);
  });

  test("one stream at a time, and the slot comes back when its body ends", async () => {
    const { hop, stream } = setup(() => new Response(upstream(4).body));
    const first = await stream({ maxBytes: 10 * MiB });
    expect((await stream({ maxBytes: 10 * MiB })).status).toBe(503);
    // Buffered hops for page details keep working meanwhile.
    expect((await hop({})).status).toBe(200);

    expect((await first.arrayBuffer()).byteLength).toBe(4 * MiB);
    expect((await stream({ maxBytes: 10 * MiB })).status).toBe(200);
  });

  test("a cancelled body gives back the slot", async () => {
    const sources: ReturnType<typeof upstream>[] = [];
    const { stream } = setup(() => {
      const source = upstream(20);
      sources.push(source);
      return new Response(source.body);
    });
    const first = await stream({ maxBytes: 50 * MiB });
    await first.body?.cancel();
    expect(sources[0]?.state.cancelled).toBe(true);
    expect((await stream({ maxBytes: 50 * MiB })).status).toBe(200);
  });

  test("a refused address answers 422 and gives back the slot", async () => {
    const { calls, stream } = setup(() => new Response("secret"));
    const refused = await stream({ addresses: ["10.0.0.7"] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: "skipped",
      reason: "blocked_url",
    });
    expect(calls).toEqual([]);
    expect((await stream({})).status).toBe(200);
  });

  test("refuses more than the upload cap or five minutes", async () => {
    const { stream } = setup(() => new Response("ok"));
    expect((await stream({ maxBytes: 100 * MiB + 1 })).status).toBe(400);
    expect((await stream({ timeoutMs: 5 * 60 * 1000 + 1 })).status).toBe(400);
  });
});
