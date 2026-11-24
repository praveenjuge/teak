import { describe, expect, test } from "bun:test";
import {
  markdownPathFor,
  negotiateMarkdown,
  type SiteAssets,
  wantsMarkdown,
  withVaryAccept,
} from "./markdownNegotiation";

const MARKDOWN_CT = "text/markdown; charset=utf-8";

function assetsWith(
  routes: Record<string, { body: string; contentType: string }>
): SiteAssets {
  return {
    fetch: (input) => {
      const url = input instanceof URL ? input : new URL(input.url);
      const route = routes[url.pathname];
      if (!route) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(route.body, {
          headers: { "Content-Type": route.contentType },
        })
      );
    },
  };
}

function request(path: string, accept: string | null): Request {
  const headers = new Headers();
  if (accept !== null) {
    headers.set("Accept", accept);
  }
  return new Request(`https://teakvault.com${path}`, { headers });
}

describe("wantsMarkdown", () => {
  test("accepts a plain Markdown request", () => {
    expect(wantsMarkdown("text/markdown")).toBe(true);
  });

  test("is case-insensitive and ignores parameters", () => {
    expect(wantsMarkdown("Text/Markdown; charset=utf-8")).toBe(true);
  });

  test("accepts Markdown among other types", () => {
    expect(wantsMarkdown("text/html;q=0.9, text/markdown;q=0.8")).toBe(true);
  });

  test("rejects a zero quality value", () => {
    expect(wantsMarkdown("text/markdown;q=0")).toBe(false);
  });

  test("rejects HTML-only and missing Accept headers", () => {
    expect(wantsMarkdown("text/html, application/xhtml+xml")).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
  });

  test("does not match lookalike types", () => {
    expect(wantsMarkdown("application/x-markdown")).toBe(false);
  });
});

describe("markdownPathFor", () => {
  test("maps the homepage to /index.md", () => {
    expect(markdownPathFor("/")).toBe("/index.md");
  });

  test("maps page paths to their .md twin", () => {
    expect(markdownPathFor("/docs")).toBe("/docs.md");
    expect(markdownPathFor("/docs/")).toBe("/docs.md");
    expect(markdownPathFor("/docs/features/import")).toBe(
      "/docs/features/import.md"
    );
  });

  test("leaves asset paths alone", () => {
    expect(markdownPathFor("/favicon.ico")).toBeNull();
    expect(markdownPathFor("/_astro/app.123.css")).toBeNull();
  });
});

describe("negotiateMarkdown", () => {
  test("returns null when the client did not ask for Markdown", async () => {
    const assets = assetsWith({});
    const result = await negotiateMarkdown(request("/", "text/html"), assets);
    expect(result).toBeNull();
  });

  test("serves the Markdown twin with negotiation headers", async () => {
    const assets = assetsWith({
      "/index.md": { body: "# Teak\n", contentType: MARKDOWN_CT },
    });
    const result = await negotiateMarkdown(
      request("/", "text/markdown"),
      assets
    );
    expect(result?.status).toBe(200);
    expect(result?.headers.get("Content-Type")).toBe(MARKDOWN_CT);
    expect(result?.headers.get("Vary")).toContain("Accept");
    expect(await result?.text()).toBe("# Teak\n");
  });

  test("answers a Markdown 404 when nothing exists at the path", async () => {
    const assets = assetsWith({});
    const result = await negotiateMarkdown(
      request("/no-such-page", "text/markdown"),
      assets
    );
    expect(result?.status).toBe(404);
    expect(result?.headers.get("Content-Type")).toBe(MARKDOWN_CT);
    const body = await result?.text();
    expect(body?.length).toBeGreaterThan(20);
    expect(body).toContain("https://teakvault.com/llms.txt");
  });

  test("answers 406 when the page exists only as HTML", async () => {
    const assets = assetsWith({
      "/pricing": { body: "<html></html>", contentType: "text/html" },
    });
    const result = await negotiateMarkdown(
      request("/pricing", "text/markdown"),
      assets
    );
    expect(result?.status).toBe(406);
    expect(await result?.text()).toContain("Accept: text/html");
  });

  test("leaves a missing asset path to the assets", async () => {
    const assets = assetsWith({});
    const result = await negotiateMarkdown(
      request("/missing.png", "text/markdown"),
      assets
    );
    expect(result).toBeNull();
  });

  test("passes existing asset paths through, such as llms.txt", async () => {
    const assets = assetsWith({
      "/llms.txt": { body: "# Teak", contentType: "text/plain" },
    });
    const result = await negotiateMarkdown(
      request("/llms.txt", "text/markdown, text/plain, */*"),
      assets
    );
    expect(result).toBeNull();
  });

  test("keeps the path out of the Markdown miss body", async () => {
    const result = await negotiateMarkdown(
      request("/x![a](https://evil.test/p.png)", "text/markdown"),
      assetsWith({})
    );
    expect(await result?.text()).not.toContain("evil.test");
  });

  test("sends no body for a HEAD request", async () => {
    const assets = assetsWith({});
    const head = new Request("https://teakvault.com/nope", {
      method: "HEAD",
      headers: { Accept: "text/markdown" },
    });
    const result = await negotiateMarkdown(head, assets);
    expect(result?.status).toBe(404);
    expect(await result?.text()).toBe("");
  });

  test("ignores other methods", async () => {
    const post = new Request("https://teakvault.com/", {
      method: "POST",
      headers: { Accept: "text/markdown" },
    });
    expect(await negotiateMarkdown(post, assetsWith({}))).toBeNull();
  });

  test("keeps a redirect instead of answering 406", async () => {
    const assets: SiteAssets = {
      fetch: (input) => {
        const path = new URL(input instanceof URL ? input.href : input.url)
          .pathname;
        return Promise.resolve(
          path === "/old"
            ? new Response(null, { status: 301, headers: { Location: "/new" } })
            : new Response("nope", { status: 404 })
        );
      },
    };
    const result = await negotiateMarkdown(
      request("/old", "text/markdown"),
      assets
    );
    expect(result?.status).toBe(301);
  });

  test("passes a 5xx from the assets through", async () => {
    const assets: SiteAssets = {
      fetch: () => Promise.resolve(new Response("boom", { status: 503 })),
    };
    const result = await negotiateMarkdown(
      request("/docs", "text/markdown"),
      assets
    );
    expect(result?.status).toBe(503);
  });
});

describe("withVaryAccept", () => {
  test("adds Accept when there is no Vary", () => {
    const response = withVaryAccept(new Response("ok"));
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  test("appends to an existing Vary", () => {
    const response = withVaryAccept(
      new Response("ok", { headers: { Vary: "Accept-Encoding" } })
    );
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Accept");
  });

  test("leaves a response that already varies on Accept untouched", () => {
    const original = new Response("ok", { headers: { Vary: "accept" } });
    expect(withVaryAccept(original)).toBe(original);
  });

  test("leaves a wildcard Vary untouched", () => {
    const original = new Response("ok", { headers: { Vary: "*" } });
    expect(withVaryAccept(original)).toBe(original);
  });
});
