import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native auth routes", () => {
  test("start page reviews pairing instead of minting on GET", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/start/page.tsx"),
      "utf8"
    );

    expect(source).toContain("Approve device");
    expect(source).toContain("Approve this device?");
    expect(source).toContain("/native/auth/approve");
    expect(source).not.toContain("createNativeAuthCode");
  });

  test("approval action mints only after an authenticated same-origin POST", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../app/native/auth/approve/route.ts"),
      "utf8"
    );

    expect(source).toContain("isSameOriginPost");
    expect(source).toContain("CROSS_SITE_BLOCKED");
    expect(source).toContain("authNative.createNativeAuthCode");
    expect(source).toContain("nativeAuthCompletionUrl");
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
