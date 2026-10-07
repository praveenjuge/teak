import { describe, expect, test } from "bun:test";
import { buildRendererContentSecurityPolicy } from "../main/contentSecurityPolicy";

// The packaged production policy before isolated development storage existed.
const productionPolicy = [
  "default-src 'self'",
  "connect-src 'self' https://*.convex.cloud https://*.convex.site wss://*.convex.cloud wss://*.convex.site https://app.teakvault.com https://teakvault.com https://files.teakvault.com https://*.r2.cloudflarestorage.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "frame-src 'self' blob: https://files.teakvault.com https://*.r2.cloudflarestorage.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");
const devFilesOrigin = "https://teak-files-development.praveenjuge.workers.dev";
const directive = (policy: string, name: string) =>
  policy
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.split(" ") ?? [];

describe("packaged renderer content security policy", () => {
  test.each([
    "https://uncommon-ladybug-882.convex.cloud",
    "https://reminiscent-kangaroo-59.convex.cloud.evil.example",
    "http://reminiscent-kangaroo-59.convex.cloud",
    "not a url",
    undefined,
  ])("keeps the production policy unchanged for %s", (convexUrl) => {
    expect(buildRendererContentSecurityPolicy(convexUrl)).toBe(
      productionPolicy
    );
  });

  test("a dev deployment build reaches the isolated Files Worker", () => {
    const policy = buildRendererContentSecurityPolicy(
      "https://reminiscent-kangaroo-59.convex.cloud"
    );
    for (const name of ["connect-src", "frame-src"]) {
      expect(directive(policy, name)).toContain(devFilesOrigin);
      expect(directive(policy, name)).toContain("https://files.teakvault.com");
      // Uploads PUT to R2 and the PDF preview frames a signed R2 URL.
      expect(directive(policy, name)).toContain(
        "https://*.r2.cloudflarestorage.com"
      );
      expect(directive(policy, name)).not.toContain("https://*.workers.dev");
    }
    expect(directive(policy, "script-src")).toEqual(["script-src", "'self'"]);
  });
});
