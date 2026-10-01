import { describe, expect, test } from "bun:test";
import vercelConfig from "../vercel.json";
import {
  canServeMarkdownNotFound,
  markdownMirrorPath,
  markdownNotFoundResponse,
  parseAcceptHeader,
  prefersMarkdown,
  qualityFor,
  resolveMarkdownRequest,
} from "./markdown-negotiation";

describe("parseAcceptHeader", () => {
  test("orders by quality, then specificity, then original order", () => {
    const entries = parseAcceptHeader(
      "text/*;q=0.5, text/markdown, text/html;q=0.9"
    );

    expect(entries.map((entry) => entry.mediaRange)).toEqual([
      "text/markdown",
      "text/html",
      "text/*",
    ]);
  });

  test("treats an unparseable q value as unacceptable", () => {
    const entries = parseAcceptHeader("text/markdown;q=oops, text/html");

    expect(qualityFor(entries, "text/markdown")).toBe(0);
  });
});

describe("prefersMarkdown", () => {
  test("is false without an Accept header", () => {
    expect(prefersMarkdown(null)).toBe(false);
  });

  test("is false for a plain browser header", () => {
    expect(
      prefersMarkdown(
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      )
    ).toBe(false);
  });

  test("is true when Markdown is the only preference", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
  });

  test("is true when Markdown wins on quality", () => {
    expect(prefersMarkdown("text/markdown;q=0.9, text/html;q=0.1")).toBe(true);
  });

  test("is true when Markdown and HTML tie, like agent curl headers", () => {
    expect(prefersMarkdown("text/markdown, text/html, */*")).toBe(true);
  });

  test("is false when HTML wins on quality", () => {
    expect(prefersMarkdown("text/markdown;q=0.4, text/html;q=0.8")).toBe(false);
  });

  test("is true when a specific range beats a higher-q wildcard", () => {
    expect(
      prefersMarkdown("text/markdown;q=0.8, text/html;q=0.5, text/*;q=0.9")
    ).toBe(true);
  });

  test("is true when HTML is explicitly refused but a wildcard allows it", () => {
    expect(prefersMarkdown("text/markdown;q=0.5, text/html;q=0, */*")).toBe(
      true
    );
  });

  test("honours the quality parameter without case sensitivity", () => {
    expect(prefersMarkdown("text/markdown;Q=0, text/html;q=0.5")).toBe(false);
  });

  test("honours a spaced-out quality parameter", () => {
    expect(prefersMarkdown("text/markdown; q = 0, text/html")).toBe(false);
  });

  test("rejects quality values outside the qvalue grammar", () => {
    expect(prefersMarkdown("text/markdown;q=0.8x, text/html")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=1.5, text/html")).toBe(false);
  });

  test("is false when Markdown is explicitly unacceptable", () => {
    expect(prefersMarkdown("text/markdown;q=0, text/html")).toBe(false);
  });

  test("is false when only a wildcard mentions Markdown", () => {
    expect(prefersMarkdown("text/*;q=0.5, */*;q=0.1")).toBe(false);
  });

  test("is false for a plain HTTP client default header", () => {
    expect(prefersMarkdown("*/*")).toBe(false);
  });
});

describe("markdownMirrorPath", () => {
  test("maps the homepage to /index.md", () => {
    expect(markdownMirrorPath("/")).toBe("/index.md");
  });

  test("maps the docs index to /docs.md", () => {
    expect(markdownMirrorPath("/docs")).toBe("/docs.md");
    expect(markdownMirrorPath("/docs/")).toBe("/docs.md");
  });

  test("maps mirrored single-segment pages", () => {
    expect(markdownMirrorPath("/docs/ai-agents")).toBe("/docs/ai-agents.md");
    expect(markdownMirrorPath("/changelog/september-2026")).toBe(
      "/changelog/september-2026.md"
    );
    expect(markdownMirrorPath("/reference/operations/create-card")).toBe(
      "/reference/operations/create-card.md"
    );
  });

  test("ignores pages without a mirror", () => {
    expect(markdownMirrorPath("/apps")).toBeNull();
    expect(markdownMirrorPath("/pricing")).toBeNull();
    expect(markdownMirrorPath("/changelog")).toBeNull();
  });

  test("ignores nested paths and direct Markdown requests", () => {
    expect(
      markdownMirrorPath("/reference/operations/create-card/extra")
    ).toBeNull();
    expect(markdownMirrorPath("/docs/ai-agents.md")).toBeNull();
    expect(markdownMirrorPath("/index.md")).toBeNull();
  });
});

describe("vercel.json cache headers", () => {
  const varyFor = (source: string) =>
    vercelConfig.headers
      .find((route) => route.source === source)
      ?.headers.find((header) => header.key === "Vary")?.value;

  test("negotiated page URLs vary on Accept", () => {
    expect(varyFor("/")).toBe("Accept");
    expect(varyFor("/docs")).toBe("Accept");
    expect(varyFor("/docs/:path*")).toBe("Accept");
    expect(varyFor("/changelog/:path*")).toBe("Accept");
    expect(varyFor("/reference/operations/:path*")).toBe("Accept");
  });

  test("top-level Markdown mirrors vary on Accept", () => {
    expect(varyFor("/index.md")).toBe("Accept");
    expect(varyFor("/docs.md")).toBe("Accept");
  });
});

describe("resolveMarkdownRequest", () => {
  const NOT_FOUND_MD =
    "# Page not found\n\n- [Back to home](https://x.test/)\n";
  const existing = new Set([
    "/pricing",
    "/docs/ai-agents.md",
    "/docs/no-mirror",
    "/index.md",
  ]);
  const calls: { path: string; method?: string; accept?: string }[] = [];

  const fakeFetch = async (input: URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: input.pathname,
      method: init?.method,
      accept: headers.get("accept") ?? undefined,
    });
    if (input.pathname === "/404.md") {
      return new Response(NOT_FOUND_MD, { status: 200 });
    }
    return new Response(null, {
      status: existing.has(input.pathname) ? 200 : 404,
    });
  };

  const request = (path: string, accept: string | null, method = "GET") =>
    new Request(`https://x.test${path}`, {
      method,
      headers: accept ? { accept } : {},
    });

  test("rewrites mirrored pages to their Markdown mirror", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/docs/ai-agents", "text/markdown"),
        fakeFetch,
      ),
    ).toEqual({ type: "rewrite", path: "/docs/ai-agents.md" });
  });

  test("answers unknown URLs with the Markdown 404 body", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/__missing", "text/markdown"),
        fakeFetch,
      ),
    ).toEqual({ type: "not-found", markdown: NOT_FOUND_MD });
  });

  test("answers mirrored paths whose mirror is missing with the 404 body", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/docs/gone", "text/markdown"),
        fakeFetch,
      ),
    ).toEqual({ type: "not-found", markdown: NOT_FOUND_MD });
  });

  test("keeps serving HTML for a page whose mirror was not built", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/docs/no-mirror", "text/markdown"),
        fakeFetch
      )
    ).toEqual({ type: "html" });
  });

  test("does not rewrite to a mirror that redirects or errors", async () => {
    for (const status of [301, 500]) {
      const brokenMirror = async (input: URL) =>
        new Response(null, {
          status: input.pathname === "/docs/ai-agents.md" ? status : 200,
        });

      expect(
        await resolveMarkdownRequest(
          request("/docs/ai-agents", "text/markdown"),
          brokenMirror
        )
      ).toEqual({ type: "html" });
    }
  });

  test("falls back to HTML when a probe or the 404 fetch rejects", async () => {
    const probeFails = async () => {
      throw new Error("network down");
    };
    const notFoundFetchFails = async (input: URL) => {
      if (input.pathname === "/404.md") {
        throw new Error("network down");
      }
      return new Response(null, { status: 404 });
    };

    expect(
      await resolveMarkdownRequest(
        request("/docs/ai-agents", "text/markdown"),
        probeFails
      )
    ).toEqual({ type: "html" });
    expect(
      await resolveMarkdownRequest(
        request("/__missing", "text/markdown"),
        notFoundFetchFails
      )
    ).toEqual({ type: "html" });
  });

  test("keeps serving HTML for existing pages without a mirror", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/pricing", "text/markdown"),
        fakeFetch,
      ),
    ).toEqual({ type: "html" });
  });

  test("never probes browsers, other methods, or proxied paths", async () => {
    calls.length = 0;
    const html = { type: "html" };

    expect(
      await resolveMarkdownRequest(
        request("/__missing", "text/html"),
        fakeFetch,
      ),
    ).toEqual(html);
    expect(
      await resolveMarkdownRequest(request("/__missing", null), fakeFetch),
    ).toEqual(html);
    expect(
      await resolveMarkdownRequest(
        request("/__missing", "text/markdown", "POST"),
        fakeFetch,
      ),
    ).toEqual(html);
    expect(
      await resolveMarkdownRequest(
        request("/api/v1/x", "text/markdown"),
        fakeFetch,
      ),
    ).toEqual(html);
    expect(calls).toEqual([]);
  });

  test("probes with HEAD and an HTML Accept so it cannot loop", async () => {
    calls.length = 0;
    await resolveMarkdownRequest(
      request("/__missing", "text/markdown"),
      fakeFetch,
    );

    expect(calls[0]).toEqual({
      path: "/__missing",
      method: "HEAD",
      accept: "text/html",
    });
  });

  test("falls back to HTML when the Markdown 404 page is unavailable", async () => {
    const broken = async (input: URL) =>
      new Response(null, { status: input.pathname === "/404.md" ? 500 : 404 });

    expect(
      await resolveMarkdownRequest(
        request("/__missing", "text/markdown"),
        broken,
      ),
    ).toEqual({ type: "html" });
  });
});

describe("markdownNotFoundResponse", () => {
  test("is a 404 Markdown response that varies on Accept", async () => {
    const response = markdownNotFoundResponse("# Not found\n", "GET");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("content-length")).toBe("12");
    expect(await response.text()).toBe("# Not found\n");
  });

  test("HEAD keeps the headers and drops the body", async () => {
    const response = markdownNotFoundResponse("# Not found\n", "HEAD");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-length")).toBe("12");
    expect(await response.text()).toBe("");
  });
});

describe("canServeMarkdownNotFound", () => {
  test("excludes proxied and platform paths only", () => {
    expect(canServeMarkdownNotFound("/api")).toBe(false);
    expect(canServeMarkdownNotFound("/api/v1/cards")).toBe(false);
    expect(canServeMarkdownNotFound("/mcp")).toBe(false);
    expect(
      canServeMarkdownNotFound("/.well-known/oauth-protected-resource"),
    ).toBe(false);
    expect(canServeMarkdownNotFound("/apple")).toBe(true);
    expect(canServeMarkdownNotFound("/pricing")).toBe(true);
  });
});
