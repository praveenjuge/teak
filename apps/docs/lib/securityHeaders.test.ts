import { describe, expect, test } from "bun:test";
import { SITE_HEADERS, withSiteHeaders } from "../scripts/security-headers";

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
