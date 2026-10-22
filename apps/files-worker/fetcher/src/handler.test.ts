import { describe, expect, test } from "bun:test";
import type { PinnedFetch } from "../../../../packages/convex/linkMetadata/ssrf";
import { createFetcherHandler } from "./handler";
import { FETCHER_HEADERS, FETCHER_MAX_IN_FLIGHT } from "./protocol";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (char) => char.charCodeAt(0)
);

const PUBLIC = "93.184.216.34";

interface Call {
  addresses: string[];
  url: string;
}

const setup = (
  dns: Record<string, string[]>,
  respond: (url: string) => Response | Promise<Response>
) => {
  const calls: Call[] = [];
  const referers: (string | null)[] = [];
  const userAgents: (string | null)[] = [];
  const pinnedFetch: PinnedFetch = (url, addresses, init) => {
    calls.push({ addresses, url });
    const headers = new Headers(init.headers);
    referers.push(headers.get("referer"));
    userAgents.push(headers.get("user-agent"));
    return Promise.resolve(respond(url));
  };
  const handle = createFetcherHandler({
    pinnedFetch,
    resolveDns: (hostname) => Promise.resolve(dns[hostname] ?? []),
  });
  const fetchAsset = (body: unknown) =>
    handle(
      new Request("http://fetcher/fetch", {
        body: JSON.stringify(body),
        method: "POST",
      })
    );
  return { calls, fetchAsset, handle, referers, userAgents };
};

const FIGMA_PAGE = "https://www.figma.com/community/file/1234/kit?node-id=1";
const FIGMA_COVER = "https://s3-alpha.figma.com/hub/file/1234/cover.png";

describe("link fetcher", () => {
  test("returns an image's bytes, type and dimensions, pinned to the checked address", async () => {
    const { calls, fetchAsset } = setup(
      { "cdn.example": [PUBLIC] },
      () =>
        new Response(ONE_PIXEL_PNG, {
          headers: { "content-type": "image/png" },
        })
    );
    const response = await fetchAsset({
      kind: "image",
      url: "https://cdn.example/a.png",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get(FETCHER_HEADERS.contentType)).toBe("image/png");
    expect(response.headers.get(FETCHER_HEADERS.width)).toBe("1");
    expect(response.headers.get(FETCHER_HEADERS.height)).toBe("1");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(ONE_PIXEL_PNG);
    expect(calls).toEqual([
      { addresses: [PUBLIC], url: "https://cdn.example/a.png" },
    ]);
  });

  test.each(["application/octet-stream", "binary/octet-stream"])(
    "types an image served as %s from its URL",
    async (contentType) => {
      const { fetchAsset } = setup(
        { "bucket.example": [PUBLIC] },
        () =>
          new Response(ONE_PIXEL_PNG, {
            headers: { "content-type": contentType },
          })
      );
      const response = await fetchAsset({
        kind: "image",
        url: "https://bucket.example/cover.png",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get(FETCHER_HEADERS.contentType)).toBe(
        "image/png"
      );
    }
  );

  test("returns a video without dimensions, typed from the caller's fallback", async () => {
    const { fetchAsset } = setup(
      { "video.example": [PUBLIC] },
      () => new Response(new Uint8Array([0, 0, 0, 24]))
    );
    const response = await fetchAsset({
      fallbackContentType: "video/mp4",
      kind: "video",
      url: "https://video.example/v",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get(FETCHER_HEADERS.contentType)).toBe("video/mp4");
    expect(response.headers.get(FETCHER_HEADERS.width)).toBeNull();
  });

  test.each([
    ["a hostname resolving to loopback", { "evil.example": ["127.0.0.1"] }],
    [
      "a hostname resolving to cloud metadata",
      { "evil.example": ["169.254.169.254"] },
    ],
    [
      "a hostname with one private address among public ones",
      { "evil.example": [PUBLIC, "10.0.0.5"] },
    ],
  ])("refuses %s without connecting", async (_name, dns) => {
    const { calls, fetchAsset } = setup(dns, () => new Response(ONE_PIXEL_PNG));
    const response = await fetchAsset({
      kind: "image",
      url: "https://evil.example/a.png",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "skipped",
      reason: "blocked_url",
    });
    expect(calls).toEqual([]);
  });

  test("refuses a redirect to a private address before following it", async () => {
    const { calls, fetchAsset } = setup(
      { "cdn.example": [PUBLIC], "internal.example": ["192.168.1.10"] },
      () => Response.redirect("https://internal.example/secret.png", 302)
    );
    const response = await fetchAsset({
      kind: "image",
      url: "https://cdn.example/a.png",
    });
    expect(await response.json()).toMatchObject({ reason: "blocked_url" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://cdn.example/a.png",
    ]);
  });

  test("presents as a browser with the page's origin as the Referer on every redirect hop", async () => {
    // s3-alpha.figma.com's bot control answers 403 to non-browser agents.
    const { calls, fetchAsset, referers, userAgents } = setup(
      { "cdn.figma.example": [PUBLIC], "s3-alpha.figma.com": [PUBLIC] },
      (url) =>
        url === FIGMA_COVER
          ? Response.redirect("https://cdn.figma.example/cover.png", 302)
          : new Response(ONE_PIXEL_PNG, {
              headers: { "content-type": "image/png" },
            })
    );
    const response = await fetchAsset({
      kind: "image",
      pageUrl: FIGMA_PAGE,
      url: FIGMA_COVER,
    });
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      FIGMA_COVER,
      "https://cdn.figma.example/cover.png",
    ]);
    expect(referers).toEqual([
      "https://www.figma.com/",
      "https://www.figma.com/",
    ]);
    for (const userAgent of userAgents) {
      expect(userAgent).toStartWith("Mozilla/5.0 (Macintosh;");
    }
    expect(userAgents).toHaveLength(2);
  });

  test("drops the Referer on a hop from an https page to http", async () => {
    const { fetchAsset, referers } = setup(
      { "cdn.example": [PUBLIC], "plain.example": [PUBLIC] },
      (url) =>
        url.startsWith("https:")
          ? Response.redirect("http://plain.example/a.png", 302)
          : new Response(ONE_PIXEL_PNG, {
              headers: { "content-type": "image/png" },
            })
    );
    const response = await fetchAsset({
      kind: "image",
      pageUrl: FIGMA_PAGE,
      url: "https://cdn.example/a.png",
    });
    expect(response.status).toBe(200);
    expect(referers).toEqual(["https://www.figma.com/", null]);
  });

  test("sends no Referer without a page", async () => {
    const { fetchAsset, referers } = setup(
      { "cdn.example": [PUBLIC] },
      () =>
        new Response(ONE_PIXEL_PNG, {
          headers: { "content-type": "image/png" },
        })
    );
    await fetchAsset({ kind: "image", url: "https://cdn.example/a.png" });
    expect(referers).toEqual([null]);
  });

  test("still refuses a private address when the page is public", async () => {
    const { calls, fetchAsset } = setup(
      { "evil.example": ["10.0.0.5"] },
      () => new Response(ONE_PIXEL_PNG)
    );
    const response = await fetchAsset({
      kind: "image",
      pageUrl: FIGMA_PAGE,
      url: "https://evil.example/a.png",
    });
    expect(await response.json()).toMatchObject({ reason: "blocked_url" });
    expect(calls).toEqual([]);
  });

  test.each([
    [
      "an HTTP error",
      () => new Response("gone", { status: 404 }),
      { reason: "http_error", status: 404 },
    ],
    [
      "a declared size over the image limit",
      () =>
        new Response(ONE_PIXEL_PNG, {
          headers: {
            "content-length": String(21 * 1024 * 1024),
            "content-type": "image/png",
          },
        }),
      { reason: "too_large" },
    ],
    [
      "a type that is not an image",
      () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
      { reason: "unsupported_type" },
    ],
    [
      "bytes that are not a readable image",
      () =>
        new Response("not a png", { headers: { "content-type": "image/png" } }),
      { reason: "invalid_image" },
    ],
    [
      "an empty body",
      () =>
        new Response(new Uint8Array(), {
          headers: { "content-type": "image/png" },
        }),
      { reason: "empty" },
    ],
  ])("skips %s", async (_name, respond, expected) => {
    const { fetchAsset } = setup({ "cdn.example": [PUBLIC] }, respond);
    const response = await fetchAsset({
      kind: "image",
      url: "https://cdn.example/a.png",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "skipped", ...expected });
  });

  test("reports a network failure as fetch_failed", async () => {
    const { fetchAsset } = setup({ "cdn.example": [PUBLIC] }, () => {
      throw new TypeError("fetch failed");
    });
    const response = await fetchAsset({
      kind: "image",
      url: "https://cdn.example/a.png",
    });
    expect(await response.json()).toMatchObject({ reason: "fetch_failed" });
  });

  test.each([
    { kind: "zip", url: "https://cdn.example/a" },
    { kind: "image" },
    { kind: "image", url: `https://cdn.example/${"a".repeat(5000)}` },
    { kind: "image", pageUrl: "javascript:alert(1)", url: "https://a/b.png" },
    { kind: "image", pageUrl: "not a url", url: "https://a/b.png" },
    { kind: "image", pageUrl: 42, url: "https://a/b.png" },
    {
      kind: "image",
      pageUrl: `https://www.figma.com/${"a".repeat(5000)}`,
      url: "https://a/b.png",
    },
  ])("rejects an invalid request %#", async (body) => {
    const { fetchAsset } = setup({}, () => new Response(ONE_PIXEL_PNG));
    expect((await fetchAsset(body)).status).toBe(400);
  });

  test("answers busy once its downloads are all in flight", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchAsset } = setup({ "cdn.example": [PUBLIC] }, async () => {
      await gate;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "content-type": "image/png" },
      });
    });
    const request = { kind: "image", url: "https://cdn.example/a.png" };
    const running = Array.from({ length: FETCHER_MAX_IN_FLIGHT }, () =>
      fetchAsset(request)
    );
    const extra = await fetchAsset(request);
    expect(extra.status).toBe(503);
    expect(await extra.json()).toEqual({ error: "busy" });
    release();
    for (const response of await Promise.all(running)) {
      expect(response.status).toBe(200);
    }
  });

  test("reports its protocol on the health check", async () => {
    const { handle } = setup({}, () => new Response(ONE_PIXEL_PNG));
    const response = await handle(new Request("http://fetcher/health"));
    expect(await response.json()).toMatchObject({ ok: true, protocol: 3 });
  });
});
