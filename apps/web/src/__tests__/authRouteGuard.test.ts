// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("auth route session handling", () => {
  test("middleware leaves auth routes reachable with stale cookies", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).toContain("if (isSignInRoute)");
    expect(source).not.toContain("isSignInRoute && sessionCookie");
  });

  test("auth routes redirect only after a live session is confirmed", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../components/AuthRouteGuard.tsx"),
      "utf8"
    );

    expect(source).toContain("authClient.useSession()");
    expect(source).toContain("if (session)");
    expect(source).toContain("getSafeNextPath");
    expect(source).toContain("fallback?: ReactNode");
    expect(source).toContain("return fallback");
  });
});
