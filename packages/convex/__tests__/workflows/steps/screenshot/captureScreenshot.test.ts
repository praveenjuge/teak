import { describe, expect, test } from "bun:test";
import { buildGenericScreenshotCode } from "../../../../../convex/workflows/steps/screenshot/captureScreenshot";

describe("workflows/steps/screenshot/captureScreenshot helpers", () => {
  test("renders only prevalidated HTML without browser network access", () => {
    const code = buildGenericScreenshotCode(
      "<html><body>Example</body></html>",
      "body { color: red; }",
      "https://files.teakvault.com/__upload/v1/users/u1/x?exp=1&sig=sig"
    );

    expect(code).toContain("page.setContent");
    expect(code).toContain("route => route.abort()");
    expect(code).toContain("Network access is disabled");
    expect(code).toContain("page.screenshot");
    expect(code).toContain("body { color: red; }");
    expect(code).not.toContain("page.goto");
  });

  test("uploads the generated screenshot directly to the Files Worker", () => {
    const uploadUrl =
      "https://files.teakvault.com/__upload/v1/users/u1/cards/screenshot/abc-shot.jpg?exp=1&sig=sig";
    const code = buildGenericScreenshotCode(
      "<html><body>Example</body></html>",
      "",
      uploadUrl
    );

    // Bytes are PUT straight to the signed destination URL instead of being
    // returned as base64.
    expect(code).toContain(`context.request.put(${JSON.stringify(uploadUrl)}`);
    expect(code).not.toContain("toString('base64')");
  });
});
