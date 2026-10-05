import { describe, expect, test } from "bun:test";
import {
  markdownNotFoundBody,
  resolveMarkdownRequest,
} from "./markdown-not-found";

const request = (path: string, accept: string) =>
  new Request(`https://teakvault.com${path}`, { headers: { accept } });

const MARKDOWN = "text/markdown";

describe("markdownNotFoundBody", () => {
  test("explains the error and links to docs, sitemap, and llms.txt", () => {
    const body = markdownNotFoundBody("/nope");

    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("/nope");
    expect(body).toContain("(/docs.md)");
    expect(body).toContain("(/sitemap.xml)");
    expect(body).toContain("(/llms.txt)");
  });
});

describe("resolveMarkdownRequest", () => {
  test("leaves browser requests alone without probing", async () => {
    let probed = false;
    const result = await resolveMarkdownRequest(
      request("/nope", "text/html,*/*;q=0.8"),
      async () => {
        probed = true;
        return 404;
      }
    );

    expect(result).toBeNull();
    expect(probed).toBe(false);
  });

  test("answers an unknown path with a Markdown 404", async () => {
    const result = await resolveMarkdownRequest(
      request("/nope", MARKDOWN),
      async () => 404
    );

    expect(result?.kind).toBe("not-found");
    if (result?.kind !== "not-found") {
      return;
    }
    expect(result.response.status).toBe(404);
    expect(result.response.headers.get("content-type")).toContain(MARKDOWN);
    expect(result.response.headers.get("vary")).toBe("Accept");
    expect(await result.response.text()).toContain("/nope");
  });

  test("probes the Markdown mirror for a docs page", async () => {
    const probed: string[] = [];
    const result = await resolveMarkdownRequest(
      request("/docs/missing", MARKDOWN),
      async (url) => {
        probed.push(url.pathname);
        return 404;
      }
    );

    expect(probed).toEqual(["/docs/missing.md"]);
    expect(result?.kind).toBe("not-found");
  });

  test("rewrites an existing page to its Markdown mirror", async () => {
    const result = await resolveMarkdownRequest(
      request("/docs/mac", MARKDOWN),
      async () => 200
    );

    expect(result).toEqual({ kind: "rewrite", path: "/docs/mac.md" });
  });

  test("passes through an existing page that has no mirror", async () => {
    const result = await resolveMarkdownRequest(
      request("/pricing", MARKDOWN),
      async () => 200
    );

    expect(result).toBeNull();
  });

  test("never blocks a page when the probe fails", async () => {
    expect(
      await resolveMarkdownRequest(
        request("/pricing", MARKDOWN),
        async () => null
      )
    ).toBeNull();
    expect(
      await resolveMarkdownRequest(
        request("/docs/mac", MARKDOWN),
        async () => null
      )
    ).toEqual({ kind: "rewrite", path: "/docs/mac.md" });
  });
});
