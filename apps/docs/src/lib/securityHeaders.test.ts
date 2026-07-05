import { describe, expect, test } from "bun:test";
import vercelConfig from "../../vercel.json";

const headers = new Map(
  vercelConfig.headers.flatMap((route) =>
    route.headers.map(({ key, value }) => [key, value] as const)
  )
);

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
});
