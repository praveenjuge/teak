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

  test("middleware no longer creates or forwards per-request CSP nonces", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).not.toContain("createNonce");
    expect(source).not.toContain("x-nonce");
    expect(source).not.toContain("Content-Security-Policy");
    expect(source).not.toContain("request: {");
  });

  test("middleware leaves public metadata and telemetry infrastructure reachable", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../proxy.ts"),
      "utf8"
    );

    expect(source).toContain('["/monitoring", "/opengraph-image"]');
    expect(source).toContain("publicInfrastructureRoutes.has");
  });

  test("auth routes render immediately and redirect only after a live session", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../components/AuthRouteGuard.tsx"),
      "utf8"
    );

    expect(source).toContain("authClient.useSession()");
    expect(source).toContain("if (session)");
    expect(source).toContain("getSafeNextPath");
    expect(source).toContain("fallback?: ReactNode");
    expect(source).not.toContain("isPending");
    expect(source).toContain("return fallback");
  });
});
