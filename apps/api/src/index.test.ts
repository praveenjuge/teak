import { afterEach, describe, expect, mock, test } from "bun:test";
import app from "./index";

const originalFetch = globalThis.fetch;
const originalEnv = process.env.CONVEX_HTTP_BASE_URL;
const originalTimeoutEnv = process.env.CONVEX_UPSTREAM_TIMEOUT_MS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.CONVEX_HTTP_BASE_URL = originalEnv;
  process.env.CONVEX_UPSTREAM_TIMEOUT_MS = originalTimeoutEnv;
});

describe("apps/api proxy", () => {
  test("returns health status", async () => {
    const response = await app.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "teak-api",
      version: "v1",
    });
  });

  test("returns API capabilities for /v1", async () => {
    const response = await app.request("/v1");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.version).toBe("v1");
    expect(payload.endpoints).toContain("POST /v1/cards");
  });

  test("fails fast when CONVEX_HTTP_BASE_URL is missing", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "";

    const response = await app.request("/v1/cards/search?limit=10");

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe("CONFIG_ERROR");
  });

  test("proxies request path, query, and auth header", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    let capturedUrl = "";
    let capturedAuthorization = "";

    globalThis.fetch = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedAuthorization =
          new Headers(init?.headers).get("authorization") ?? "";

        return new Response(JSON.stringify({ items: [], total: 0 }), {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        });
      }
    ) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/search?q=design&limit=10", {
      headers: {
        Authorization: "Bearer teakapi_test",
      },
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe(
      "https://example.convex.site/v1/cards/search?q=design&limit=10"
    );
    expect(capturedAuthorization).toBe("Bearer teakapi_test");
  });

  test("passes through upstream status and payload", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({ code: "INVALID_INPUT", error: "Bad" }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 400,
        }
      );
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards", {
      body: JSON.stringify({ content: "" }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_INPUT",
      error: "Bad",
    });
  });

  test("fails when upstream returns non-JSON on successful response", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    globalThis.fetch = mock(async () => {
      return new Response("<html>ok</html>", {
        headers: {
          "Content-Type": "text/html",
        },
        status: 200,
      });
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/favorites?limit=10", {
      method: "GET",
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "UPSTREAM_INVALID_RESPONSE",
      error: "Upstream returned an invalid success payload",
    });
  });

  test("fails when upstream returns empty JSON payload on success", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    globalThis.fetch = mock(async () => {
      return new Response("", {
        headers: {
          "Content-Type": "application/json",
        },
        status: 200,
      });
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/search?limit=10", {
      method: "GET",
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "UPSTREAM_INVALID_RESPONSE",
      error: "Upstream returned an empty JSON payload",
    });
  });

  test("fails when upstream returns malformed JSON payload on success", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    globalThis.fetch = mock(async () => {
      return new Response("{", {
        headers: {
          "Content-Type": "application/json",
        },
        status: 200,
      });
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/search?limit=10", {
      method: "GET",
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: "UPSTREAM_INVALID_RESPONSE",
      error: "Upstream returned malformed JSON payload",
    });
  });

  test("strips content-encoding when forwarding reconstructed JSON body", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ items: [], total: 0 }), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/search?limit=10", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.json()).toEqual({ items: [], total: 0 });
  });

  test("returns timeout error when upstream request hangs", async () => {
    process.env.CONVEX_HTTP_BASE_URL = "https://example.convex.site";
    process.env.CONVEX_UPSTREAM_TIMEOUT_MS = "5";

    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Request aborted"));
        });
      });
    }) as unknown as typeof fetch;

    const response = await app.request("/v1/cards/favorites?limit=10", {
      method: "GET",
    });

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      code: "UPSTREAM_TIMEOUT",
      error: "Upstream request timed out",
    });
  });
});
