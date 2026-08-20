import { describe, expect, test } from "bun:test";
import { buildGenericScreenshotCode } from "../../../../../convex/workflows/steps/screenshot/captureScreenshot";

describe("workflows/steps/screenshot/captureScreenshot helpers", () => {
  test("renders only prevalidated HTML without browser network access", () => {
    const code = buildGenericScreenshotCode(
      "<html><body>Example</body></html>",
      "body { color: red; }"
    );

    expect(code).toContain("page.setContent");
    expect(code).toContain("route => route.abort()");
    expect(code).toContain("Network access is disabled");
    expect(code).toContain("page.screenshot");
    expect(code).toContain("body { color: red; }");
    expect(code).not.toContain("page.goto");
  });
});
