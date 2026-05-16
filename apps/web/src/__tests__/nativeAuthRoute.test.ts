// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native auth routes", () => {
  test("start route validates native surfaces and uses native auth mutation", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/start/route.ts"),
      "utf8"
    );

    expect(source).toContain('"desktop"');
    expect(source).toContain('"safari-macos"');
    expect(source).toContain('"safari-ios"');
    expect(source).toContain('"safari-ipados"');
    expect(source).toContain("INVALID_NATIVE_AUTH_REQUEST");
    expect(source).toContain("authNative.createNativeAuthCode");
    expect(source).toContain("/native/auth/complete");
  });

  test("middleware allows native auth handoff routes through", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).toContain('startsWith("/native/auth")');
  });
});
