import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  FILES_PROTOCOL_VERSION,
  type FilesScrapeResult,
} from "@teak/files-protocol";
import type { FetcherPageResponse } from "../fetcher/src/protocol";
import { decodeHtmlParam } from "./browserRender";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { fetchLinkPage } from "./linkPage";
import { type FilesOpsEnv, handleInternalOp } from "./ops";

const SECRET = "test-secret";
const URL_ = "https://site.example/post";
const SELECTORS = ["meta[property='og:title']", "head > title"];
const HTML = "<html><head><title>Café &amp; co</title></head></html>";

const page = (
  overrides: Partial<FetcherPageResponse> = {}
): FetcherPageResponse => ({
  charset: "windows-1252",
  html: HTML,
  pageUrl: "https://site.example/final",
  selectors: [
    { results: [], selector: SELECTORS[0] as string },
    { results: [{ text: "Café & co" }], selector: SELECTORS[1] as string },
  ],
  ...overrides,
});

const EMPTY_SELECTORS = SELECTORS.map((selector) => ({
  results: [],
  selector,
}));

interface FetcherCall {
  body: Record<string, unknown>;
  instance: string;
  path: string;
}

const fetcherPool = (answer: (call: FetcherCall) => Response) => {
  const calls: FetcherCall[] = [];
  const namespace = {
    get: (instance: string) => ({
      fetch: async (request: Request) => {
        const call = {
          body: await request.json(),
          instance,
          path: new URL(request.url).pathname,
        };
        calls.push(call);
        return answer(call);
      },
    }),
    idFromName: (name: string) => name,
  };
  return { calls, namespace: namespace as unknown as DurableObjectNamespace };
};

const runOp = async (
  answer: (call: FetcherCall) => Response,
  params: Record<string, unknown> = { selectors: SELECTORS, url: URL_ }
) => {
  const pool = fetcherPool(answer);
  const body = JSON.stringify({
    op: "fetch-link-page",
    params,
    version: FILES_PROTOCOL_VERSION,
  });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
      headers: {
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": await hmacSha256Hex(
          SECRET,
          buildFilesOpSigningPayload({
            bodySha256: await sha256Hex(body),
            expiresAt,
            requestId,
          })
        ),
      },
      method: "POST",
    }),
    {
      FILES_SIGNING_SECRET: SECRET,
      LINK_FETCHER: pool.namespace,
      LINK_FETCHER_INSTANCES: "2",
    } as FilesOpsEnv
  );
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; retryable: boolean };
    },
    calls: pool.calls,
    status: response.status,
  };
};

describe("fetch-link-page op", () => {
  test("returns the Container's static scrape, page URL, charset and gzipped HTML", async () => {
    const { body, calls } = await runOp(() => Response.json(page()));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/fetch-page");
    expect(calls[0]?.body).toEqual({ selectors: SELECTORS, url: URL_ });
    const { htmlGzipBase64, ...rest } = body.data as Record<string, unknown>;
    expect(rest).toEqual({
      charset: "windows-1252",
      fetched: true,
      pageUrl: "https://site.example/final",
      selectors: page().selectors,
      source: "static",
    });
    // The encoding scrape-html and capture-screenshot already accept.
    expect(await decodeHtmlParam(htmlGzipBase64)).toBe(HTML);
  });

  test("passes the Container's refusal through as a result, not an error", async () => {
    const { body } = await runOp(() =>
      Response.json(
        {
          contentType: "application/pdf",
          error: "skipped",
          reason: "unsupported_type",
        },
        { status: 422 }
      )
    );
    expect(body.data).toEqual({
      contentType: "application/pdf",
      fetched: false,
      reason: "unsupported_type",
    });
  });

  test("keeps an HTTP status and maps an unknown refusal to fetch_failed", async () => {
    const http = await runOp(() =>
      Response.json(
        { error: "skipped", reason: "http_error", status: 404 },
        { status: 422 }
      )
    );
    expect(http.body.data).toEqual({
      fetched: false,
      reason: "http_error",
      status: 404,
    });
    const unknown = await runOp(() =>
      Response.json({ error: "skipped", reason: "nope" }, { status: 422 })
    );
    expect(unknown.body.data).toEqual({
      fetched: false,
      reason: "fetch_failed",
    });
  });

  test("moves past a busy instance and is retryable when all are busy", async () => {
    let answered = 0;
    const once = await runOp(() => {
      answered += 1;
      return answered === 1
        ? new Response(JSON.stringify({ error: "busy" }), { status: 503 })
        : Response.json(page());
    });
    expect(once.calls).toHaveLength(2);
    expect(once.calls[0]?.instance).not.toBe(once.calls[1]?.instance);
    expect(once.body.data).toMatchObject({ fetched: true });
    const allBusy = await runOp(
      () => new Response(JSON.stringify({ error: "busy" }), { status: 503 })
    );
    expect(allBusy.calls).toHaveLength(2);
    expect(allBusy.body.error).toMatchObject({
      code: "RENDERER_UNAVAILABLE",
      retryable: true,
    });
  });

  test("treats a malformed Container answer as the Container being unavailable", async () => {
    const { body } = await runOp(() =>
      Response.json({ ...page(), pageUrl: "javascript:alert(1)" })
    );
    expect(body.error).toMatchObject({
      code: "RENDERER_UNAVAILABLE",
      retryable: true,
    });
  });

  test.each([
    ["no selectors", { url: URL_ }],
    ["no URL", { selectors: SELECTORS }],
    [
      "a URL over 4096 characters",
      { selectors: SELECTORS, url: `https://a.example/${"x".repeat(4096)}` },
    ],
  ])(
    "rejects params with %s without calling the Container",
    async (_label, params) => {
      const { body, calls, status } = await runOp(
        () => Response.json(page()),
        params
      );
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_INPUT");
      expect(calls).toEqual([]);
    }
  );
});

describe("Browser Run fallback", () => {
  const env = (answer: () => Response) => ({
    LINK_FETCHER: fetcherPool(answer).namespace,
    LINK_FETCHER_INSTANCES: "1",
  });
  const rendered: FilesScrapeResult = {
    selectors: [
      {
        results: [{ attributes: [{ name: "content", value: "From JS" }] }],
        selector: SELECTORS[0] as string,
      },
      { results: [], selector: SELECTORS[1] as string },
    ],
  };

  test("renders the same HTML when the static scrape matched nothing", async () => {
    const scrapes: { html: string; selectors: string[] }[] = [];
    const result = await fetchLinkPage(
      env(() => Response.json(page({ selectors: EMPTY_SELECTORS }))),
      { selectors: SELECTORS, url: URL_ },
      {
        scrape: (html, selectors) => {
          scrapes.push({ html, selectors });
          return Promise.resolve(rendered);
        },
      }
    );
    expect(scrapes).toEqual([{ html: HTML, selectors: SELECTORS }]);
    expect(result).toMatchObject({
      fetched: true,
      selectors: rendered.selectors,
      source: "browser",
    });
  });

  test("uses the browser result even when it is also empty, as Convex did", async () => {
    const result = await fetchLinkPage(
      env(() => Response.json(page({ selectors: EMPTY_SELECTORS }))),
      { selectors: SELECTORS, url: URL_ },
      { scrape: () => Promise.resolve({ selectors: EMPTY_SELECTORS }) }
    );
    expect(result).toMatchObject({ source: "browser" });
  });

  test("keeps the static result when the browser fails or is absent", async () => {
    const failing = await fetchLinkPage(
      env(() => Response.json(page({ selectors: EMPTY_SELECTORS }))),
      { selectors: SELECTORS, url: URL_ },
      { scrape: () => Promise.reject(new Error("browser_binding_missing")) }
    );
    expect(failing).toMatchObject({
      selectors: EMPTY_SELECTORS,
      source: "static",
    });
    const absent = await fetchLinkPage(
      env(() => Response.json(page({ selectors: EMPTY_SELECTORS }))),
      { selectors: SELECTORS, url: URL_ }
    );
    expect(absent).toMatchObject({ source: "static" });
  });

  test.each([
    ["the static scrape matched", page()],
    ["the page is empty", page({ html: "", selectors: EMPTY_SELECTORS })],
  ])("skips the browser when %s", async (_label, answer) => {
    let scraped = false;
    const result = await fetchLinkPage(
      env(() => Response.json(answer)),
      { selectors: SELECTORS, url: URL_ },
      {
        scrape: () => {
          scraped = true;
          return Promise.resolve(rendered);
        },
      }
    );
    expect(scraped).toBe(false);
    expect(result).toMatchObject({ source: "static" });
  });
});
