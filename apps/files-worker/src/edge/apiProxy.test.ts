import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { unstable_readConfig } from "wrangler";
import {
  API_PROXY_DOCUMENT_TTL_SECONDS,
  API_PROXY_MAX_BODY_BYTES,
  type ApiProxyEnv,
  handleApiProxyRequest,
} from "./apiProxy";

const prodConfig = unstable_readConfig({
  config: resolve(import.meta.dir, "../../wrangler.jsonc"),
});

const ENV: ApiProxyEnv = {
  API_PUBLIC_HOST: "teakvault.com",
  API_UPSTREAM_ORIGIN: "https://upstream.example.convex.site",
};

interface UpstreamCall {
  body: string;
  headers: Headers;
  method: string;
  redirect: RequestRedirect | undefined;
  url: string;
}

const upstream = (
  respond: (call: UpstreamCall) => Response = () =>
    new Response('{"ok":true}', {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    })
) => {
  const calls: UpstreamCall[] = [];
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const body = init.body
      ? await new Response(init.body as BodyInit).text()
      : "";
    const call = {
      body,
      headers: new Headers(init.headers),
      method: init.method ?? "GET",
      redirect: init.redirect,
      url: String(input),
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetcher };
};

class FakeCache {
  readonly entries = new Map<string, Response>();

  match(request: Request): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(request.url)?.clone());
  }

  async put(request: Request, response: Response): Promise<void> {
    const body = await response.arrayBuffer();
    this.entries.set(request.url, new Response(body, response));
  }
}

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    pending.push(promise);
  },
};
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const proxy = (
  request: Request,
  options: { cache?: FakeCache; fetcher?: typeof fetch } = {},
  env: ApiProxyEnv = ENV
) =>
  handleApiProxyRequest(request, env, ctx, {
    cache: (options.cache ?? null) as Cache | null,
    fetcher: options.fetcher,
  });

const FORMER_DOCS_REWRITES = [
  { source: "/api", destination: "/v1" },
  { source: "/api/:path*", destination: "/:path*" },
  { source: "/mcp", destination: "/mcp" },
  { source: "/mcp/:path*", destination: "/mcp/:path*" },
  ...[
    "/.well-known/teak-oauth-clients.json",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ].map((path) => ({ source: path, destination: path })),
].map(({ source, destination }) => ({
  source,
  destination: `https://uncommon-ladybug-882.convex.site${destination}`,
}));

describe("parity with the docs site's former rewrites", () => {
  const rewrites = FORMER_DOCS_REWRITES.map((rewrite) => ({
    source: rewrite.source.replace(":path*", "v1/cards"),
    destination: rewrite.destination.replace(":path*", "v1/cards"),
  }));

  test("the production Worker forwards to the origin the rewrites used", () => {
    const origins = new Set(
      FORMER_DOCS_REWRITES.map((rewrite) => new URL(rewrite.destination).origin)
    );
    expect([...origins]).toEqual([String(prodConfig.vars.API_UPSTREAM_ORIGIN)]);
    expect(prodConfig.vars.API_PUBLIC_HOST).toBe("teakvault.com");
  });

  test.each(rewrites)("$source reaches $destination", async (rewrite) => {
    const { calls, fetcher } = upstream();
    const env = {
      API_PUBLIC_HOST: String(prodConfig.vars.API_PUBLIC_HOST),
      API_UPSTREAM_ORIGIN: String(prodConfig.vars.API_UPSTREAM_ORIGIN),
    };
    const response = await proxy(
      new Request(`https://teakvault.com${rewrite.source}?limit=5`),
      { fetcher },
      env
    );
    expect(response?.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([
      `${rewrite.destination}?limit=5`,
    ]);
  });

  test.each(rewrites)("a production route catches $source", (rewrite) => {
    const routePatterns = (prodConfig.routes ?? []).flatMap((route) =>
      typeof route === "object" && "zone_name" in route ? [route.pattern] : []
    );
    const url = `teakvault.com${rewrite.source}?limit=5`;
    expect(
      routePatterns.some((pattern) =>
        pattern.endsWith("*")
          ? url.startsWith(pattern.slice(0, -1))
          : url === pattern
      )
    ).toBe(true);
  });
});

describe("forwarding", () => {
  test("sends the method, body and credentials to Convex and returns its answer", async () => {
    const { calls, fetcher } = upstream(
      () => new Response('{"id":"card_1"}', { status: 201 })
    );
    const response = await proxy(
      new Request("https://teakvault.com/api/v1/cards", {
        method: "POST",
        body: '{"content":"hello"}',
        headers: {
          Authorization: "Bearer teak_sk_test",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
          "CF-Ray": "abc123",
          "X-Forwarded-For": "198.51.100.1",
        },
      }),
      { fetcher }
    );

    expect(response?.status).toBe(201);
    expect(await response?.text()).toBe('{"id":"card_1"}');
    const [call] = calls;
    expect(call?.url).toBe("https://upstream.example.convex.site/v1/cards");
    expect(call?.method).toBe("POST");
    expect(call?.body).toBe('{"content":"hello"}');
    expect(call?.headers.get("authorization")).toBe("Bearer teak_sk_test");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("cf-ray")).toBeNull();
    expect(call?.headers.get("cf-connecting-ip")).toBeNull();
    expect(call?.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(call?.headers.get("x-forwarded-host")).toBe("teakvault.com");
  });

  test("adds the site's security headers to Convex's response", async () => {
    const { fetcher } = upstream(
      () =>
        new Response("{}", {
          headers: { "Access-Control-Allow-Origin": "*" },
        })
    );
    const response = await proxy(new Request("https://teakvault.com/mcp"), {
      fetcher,
    });
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("x-frame-options")).toBe("DENY");
    expect(response?.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(response?.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'"
    );
  });

  test("passes redirects through instead of following them", async () => {
    const { calls, fetcher } = upstream(() =>
      Response.redirect("https://teakvault.com/docs", 302)
    );
    const response = await proxy(
      new Request("https://teakvault.com/api/v1/me"),
      { fetcher }
    );
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(
      "https://teakvault.com/docs"
    );
    expect(calls[0]?.redirect).toBe("manual");
  });

  test("streams MCP event-stream responses through", async () => {
    const encoder = new TextEncoder();
    const { fetcher } = upstream(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("event: message\n"));
              controller.enqueue(encoder.encode('data: {"id":1}\n\n'));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } }
        )
    );
    const response = await proxy(
      new Request("https://teakvault.com/mcp", {
        method: "POST",
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      }),
      { fetcher }
    );
    expect(response?.headers.get("content-type")).toBe("text/event-stream");
    expect(await response?.text()).toBe('event: message\ndata: {"id":1}\n\n');
  });

  test("refuses a body over Convex's limit without calling Convex", async () => {
    const { calls, fetcher } = upstream();
    const response = await proxy(
      new Request("https://teakvault.com/api/v1/cards", {
        method: "POST",
        body: "{}",
        headers: { "Content-Length": String(API_PROXY_MAX_BODY_BYTES + 1) },
      }),
      { fetcher }
    );
    expect(response?.status).toBe(413);
    expect(await response?.json()).toEqual({
      code: "CONTENT_TOO_LARGE",
      error: "Request body is too large",
    });
    expect(calls).toHaveLength(0);
  });

  test("answers 502 in the API's error shape when Convex is unreachable", async () => {
    const fetcher = (() =>
      Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
    const response = await proxy(
      new Request("https://teakvault.com/api/v1/cards"),
      { fetcher }
    );
    expect(response?.status).toBe(502);
    expect(await response?.json()).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("errors the Worker answers itself", () => {
  test.each([
    [
      "413",
      () =>
        proxy(
          new Request("https://teakvault.com/api/v1/cards", {
            method: "POST",
            body: "{}",
            headers: {
              "Content-Length": String(API_PROXY_MAX_BODY_BYTES + 1),
            },
          })
        ),
    ],
    [
      "502",
      () =>
        proxy(new Request("https://teakvault.com/api/v1/cards"), {
          fetcher: (() =>
            Promise.reject(new TypeError("down"))) as unknown as typeof fetch,
        }),
    ],
  ])(
    "%s carries the API's CORS headers, a request ID and no-store",
    async (_status, send) => {
      const response = await send();
      expect(response?.headers.get("access-control-allow-origin")).toBe("*");
      expect(response?.headers.get("access-control-expose-headers")).toContain(
        "X-Request-Id"
      );
      expect(response?.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
      expect(response?.headers.get("cache-control")).toBe("no-store");
    }
  );
});

describe("edge rate limits", () => {
  const withLimit = (
    outcome: { response: Response } | { attestation: string | null },
    fetcher: typeof fetch
  ) =>
    handleApiProxyRequest(
      new Request("https://teakvault.com/api/v1/me", {
        headers: {
          Authorization: "Bearer teak_key",
          "x-teak-edge-rate-limit": "9999999999.forged",
        },
      }),
      ENV,
      ctx,
      { fetcher, rateLimit: () => Promise.resolve(outcome) }
    );

  test("forwards the Worker's attestation and never the client's", async () => {
    const { calls, fetcher } = upstream();
    await withLimit({ attestation: "1700000000.signed" }, fetcher);
    expect(calls[0]?.headers.get("x-teak-edge-rate-limit")).toBe(
      "1700000000.signed"
    );

    const unattested = upstream();
    await withLimit({ attestation: null }, unattested.fetcher);
    expect(
      unattested.calls[0]?.headers.get("x-teak-edge-rate-limit")
    ).toBeNull();
  });

  test("answers a refused request without reaching Convex", async () => {
    const { calls, fetcher } = upstream();
    const response = await withLimit(
      { response: new Response("{}", { status: 429 }) },
      fetcher
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get("x-frame-options")).toBe("DENY");
    expect(calls).toHaveLength(0);
  });
});

describe("upstream origin pinning", () => {
  test.each([
    "/api//evil.example/x",
    "/api/\\evil.example/x",
    "/api///evil.example",
    "/mcp//evil.example/x",
  ])("%s still goes to the Convex origin", async (path) => {
    const { calls, fetcher } = upstream();
    await proxy(new Request(`https://teakvault.com${path}`), { fetcher });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? "").origin).toBe(
      "https://upstream.example.convex.site"
    );
  });
});

describe("requests the proxy leaves alone", () => {
  test.each([
    ["the files host", "https://files.teakvault.com/api/v1/cards"],
    ["a docs page", "https://teakvault.com/docs/api"],
    ["a path the route caught only by prefix", "https://teakvault.com/apis"],
    [
      "another discovery document",
      "https://teakvault.com/.well-known/oauth-protected-resourcefoo",
    ],
  ])("%s", async (_label, url) => {
    const { calls, fetcher } = upstream();
    expect(await proxy(new Request(url), { fetcher })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("everything, when the Worker has no public host configured", async () => {
    const { calls, fetcher } = upstream();
    const response = await proxy(
      new Request("https://teakvault.com/api/v1/cards"),
      { fetcher },
      {}
    );
    expect(response).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("edge-cached discovery documents", () => {
  test("serves the OpenAPI spec from the edge after the first request, still no-store for clients", async () => {
    const cache = new FakeCache();
    const { calls, fetcher } = upstream();
    const first = await proxy(
      new Request("https://teakvault.com/api/openapi.json"),
      { cache, fetcher }
    );
    await settle();
    const second = await proxy(
      new Request("https://teakvault.com/api/openapi.json"),
      { cache, fetcher }
    );

    expect(calls).toHaveLength(1);
    expect(await first?.text()).toBe('{"ok":true}');
    expect(await second?.text()).toBe('{"ok":true}');
    expect(first?.headers.get("cache-control")).toBe("no-store");
    expect(second?.headers.get("cache-control")).toBe("no-store");
    expect(second?.headers.get("x-frame-options")).toBe("DENY");
    expect(
      cache.entries
        .get("https://teakvault.com/api/openapi.json")
        ?.headers.get("cache-control")
    ).toBe(`public, max-age=${API_PROXY_DOCUMENT_TTL_SECONDS}`);
  });

  test("gives each cache hit its own request ID", async () => {
    const cache = new FakeCache();
    const { fetcher } = upstream(
      () =>
        new Response("{}", {
          headers: { "Cache-Control": "no-store", "X-Request-Id": "req-miss" },
        })
    );
    const request = () =>
      new Request("https://teakvault.com/.well-known/oauth-protected-resource");
    const first = await proxy(request(), { cache, fetcher });
    await settle();
    const second = await proxy(request(), { cache, fetcher });
    const third = await proxy(request(), { cache, fetcher });

    expect(first?.headers.get("x-request-id")).toBe("req-miss");
    const hitIds = [second, third].map((response) =>
      response?.headers.get("x-request-id")
    );
    expect(hitIds[0]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Set(["req-miss", ...hitIds]).size).toBe(3);
  });

  test.each([
    [
      "an authorized request",
      new Request(
        "https://teakvault.com/.well-known/oauth-protected-resource",
        {
          headers: { Authorization: "Bearer token" },
        }
      ),
      200,
    ],
    [
      "an error response",
      new Request("https://teakvault.com/.well-known/teak-oauth-clients.json"),
      503,
    ],
    ["an API call", new Request("https://teakvault.com/api/v1/me"), 200],
  ])("does not cache %s", async (_label, request, status) => {
    const cache = new FakeCache();
    const { calls, fetcher } = upstream(() => new Response("{}", { status }));
    await proxy(request.clone(), { cache, fetcher });
    await settle();
    await proxy(request.clone(), { cache, fetcher });
    expect(calls).toHaveLength(2);
    expect(cache.entries.size).toBe(0);
  });
});
