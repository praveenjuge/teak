import { describe, expect, test } from "bun:test";
import { buildGenericScreenshotCode } from "../../../../../convex/workflows/steps/screenshot/captureScreenshot";

describe("workflows/steps/screenshot/captureScreenshot helpers", () => {
  test("buildGenericScreenshotCode uses page navigation screenshot flow", () => {
    const code = buildGenericScreenshotCode(
      "https://example.com",
      "body { color: red; }"
    );

    expect(code).toContain("page.goto");
    expect(code).toContain("networkidle");
    expect(code).toContain("page.screenshot");
    expect(code).toContain("body { color: red; }");
  });

  test("buildGenericScreenshotCode adds X-specific waits for status URLs", () => {
    const code = buildGenericScreenshotCode(
      "https://x.com/test/status/20",
      "body { color: red; }"
    );

    expect(code).toContain("const isXStatus = true");
    expect(code).toContain("waitUntil: isXStatus ? 'domcontentloaded'");
    expect(code).toContain('article[data-testid="tweet"]');
    expect(code).toContain('[data-testid="tweetText"]');
    expect(code).toContain("page.waitForTimeout(8000)");
    expect(code).not.toContain("platform.twitter.com/widgets.js");
  });
});
