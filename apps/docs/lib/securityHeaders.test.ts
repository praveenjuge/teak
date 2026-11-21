import { describe, expect, test } from "bun:test";
import {
  preloadRules,
  SITE_HEADERS,
  sharedPreloads,
  withSiteHeaders,
} from "../scripts/security-headers";

const headers = new Map<string, string>(Object.entries(SITE_HEADERS));

const blumeHeaders = [
  "/*.md",
  "  Content-Type: text/markdown; charset=utf-8",
  "/.well-known/api-catalog",
  "  Access-Control-Allow-Origin: *",
  "/blume-assets/*.svg",
  "  Content-Security-Policy: sandbox",
  "/blume-assets/*.svg",
  "  X-Content-Type-Options: nosniff",
  "",
].join("\n");

describe("documentation site security headers", () => {
  test("prevents framing and MIME sniffing", () => {
    expect(headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("limits referrers, browser capabilities, and downgrade risk", () => {
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Strict-Transport-Security")).toContain(
      "includeSubDomains"
    );
  });

  test("sends every site header once on every path", () => {
    const output = withSiteHeaders(blumeHeaders);

    expect(
      output.endsWith(
        [
          "/*",
          ...Object.entries(SITE_HEADERS).map(([n, v]) => `  ${n}: ${v}`),
          "",
        ].join("\n")
      )
    ).toBe(true);
    for (const [name, value] of Object.entries(SITE_HEADERS)) {
      expect(output.split(`${name}: ${value}`)).toHaveLength(2);
    }
  });

  test("keeps Blume's own rules that differ from the site headers", () => {
    const output = withSiteHeaders(blumeHeaders);

    expect(output).toContain(
      "/*.md\n  Content-Type: text/markdown; charset=utf-8"
    );
    expect(output).toContain(
      "/blume-assets/*.svg\n  Content-Security-Policy: sandbox"
    );
    expect(output).not.toContain("/.well-known/api-catalog");
  });
});

describe("Early Hints preloads", () => {
  const page = (css: string) =>
    `<head><link rel="preload" href="/_astro/fonts/a.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/_astro/base.css"><link rel="stylesheet" href="${css}"><link rel="icon" href="/favicon.ico"></head>`;

  test("preloads only the font and stylesheets every page loads", () => {
    expect(
      sharedPreloads([page("/_astro/a.css"), page("/_astro/b.css")])
    ).toEqual([
      '</_astro/fonts/a.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin',
      "</_astro/base.css>; rel=preload; as=style",
    ]);
  });

  test("ignores redirect stubs that load nothing", () => {
    expect(
      sharedPreloads([
        '<meta http-equiv="refresh" content="0;url=/docs">',
        page("/_astro/a.css"),
      ])
    ).toHaveLength(3);
  });

  test("groups them by top-level section, under Cloudflare's rule limit", () => {
    const rules = preloadRules([
      { path: "/", html: page("/_astro/home.css") },
      { path: "/docs/a", html: page("/_astro/a.css") },
      { path: "/docs/b", html: page("/_astro/b.css") },
    ]);
    expect(rules.map((rule) => rule.path)).toEqual(["/", "/docs*"]);
    expect(rules[1]?.lines[0]).toContain("</_astro/base.css>");
    expect(rules[1]?.lines[0]).not.toContain("a.css");
  });

  test("adds the rules before the site-wide headers", () => {
    const output = withSiteHeaders(blumeHeaders, [
      {
        path: "/docs*",
        lines: ["Link: </_astro/base.css>; rel=preload; as=style"],
      },
    ]);
    expect(output).toContain(
      "/docs*\n  Link: </_astro/base.css>; rel=preload; as=style\n/*\n"
    );
  });
});
