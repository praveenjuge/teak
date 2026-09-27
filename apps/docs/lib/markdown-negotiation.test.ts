import { describe, expect, test } from "bun:test";
import vercelConfig from "../vercel.json";
import {
  markdownMirrorPath,
  parseAcceptHeader,
  prefersMarkdown,
  qualityFor,
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
