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
    expect(source).toContain('"browser-extension"');
    expect(source).toContain("INVALID_NATIVE_AUTH_REQUEST");
    expect(source).toContain("authNative.createNativeAuthCode");
    expect(source).toContain("/native/auth/complete");
  });

  test("start route passes the surface through to the completion redirect", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/start/route.ts"),
      "utf8"
    );

    expect(source).toContain(
      'redirectUri.searchParams.set("surface", surface)'
    );
  });

  test("completion page tailors copy for the browser extension surface", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/complete/page.tsx"),
      "utf8"
    );

    expect(source).toContain("useSearchParams");
    expect(source).toContain('"browser-extension"');
    expect(source).toContain("Teak icon");
  });

  test("middleware allows native auth handoff routes through", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).toContain('startsWith("/native/auth")');
  });
});
