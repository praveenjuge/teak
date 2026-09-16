#!/usr/bin/env bun
/**
 * Clean-container web session smoke (issue #407, Phase 5).
 *
 * Proves a local authenticated journey without production secrets: sign up
 * a random local user, sign in, and show the session reaches `/` while
 * anonymous requests redirect to `/login`. Local sign-in does not require
 * verified email, so no verification step is needed. Reads ONLY the web
 * target's declared dotenv file explicitly. Reports status and names;
 * credentials are random per run and never printed.
 *
 * Usage: bun run smoke:web [--base-url <url>] [--json]
 */

import { randomUUID } from "node:crypto";
import { loadTargetEnv } from "./env-loader.ts";

export const SMOKE_VERSION = 1;

export interface SmokeStep {
  detail: string;
  id: string;
  ok: boolean;
}

export interface SmokeReport {
  baseUrl: string;
  ok: boolean;
  steps: SmokeStep[];
  version: number;
}

const fetchText = async (
  url: string,
  init: RequestInit = {}
): Promise<{ body: string; headers: Headers; status: number }> => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  return {
    body: await response.text(),
    headers: response.headers,
    status: response.status,
  };
};

/** Cookie header from every Set-Cookie pair, values never logged. */
export const cookiesFrom = (headers: Headers): string =>
  headers
    .getSetCookie()
    .map((pair) => pair.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");

export const runSmoke = async (baseUrl: string): Promise<SmokeReport> => {
  const steps: SmokeStep[] = [];
  const fail = (id: string, detail: string): SmokeReport => {
    steps.push({ id, ok: false, detail });
    return { version: SMOKE_VERSION, baseUrl, ok: false, steps };
  };

  const loaded = loadTargetEnv("web", "local");
  const convexUrl = loaded.values.get("NEXT_PUBLIC_CONVEX_URL");
  const convexSiteUrl = loaded.values.get("NEXT_PUBLIC_CONVEX_SITE_URL");
  if (!(convexUrl && convexSiteUrl)) {
    return fail(
      "smoke-config",
      "apps/web/.env.local is missing NEXT_PUBLIC_CONVEX_* (run bun run setup --target web)"
    );
  }
  steps.push({ id: "smoke-config", ok: true, detail: "convex origins loaded" });

  const login = await fetchText(`${baseUrl}/login`);
  if (login.status !== 200) {
    return fail("smoke-login-page", `GET /login returned ${login.status}`);
  }
  steps.push({ id: "smoke-login-page", ok: true, detail: "GET /login is 200" });

  const anonymous = await fetchText(`${baseUrl}/`, { redirect: "manual" });
  const location = anonymous.headers.get("location") ?? "";
  if (
    !(
      [301, 302, 303, 307, 308].includes(anonymous.status) &&
      location.includes("/login")
    )
  ) {
    return fail(
      "smoke-auth-gate",
      `anonymous GET / returned ${anonymous.status} (expected a /login redirect)`
    );
  }
  steps.push({
    id: "smoke-auth-gate",
    ok: true,
    detail: "anonymous / redirects to /login",
  });

  const email = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}@teakvault.local`;
  const password = `${randomUUID()}${randomUUID()}!aA`;
  const signUp = await fetchText(`${convexSiteUrl}/api/auth/sign-up/email`, {
    body: JSON.stringify({ email, password, name: "Smoke User" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!(signUp.status === 200 || signUp.status === 201)) {
    return fail("smoke-sign-up", `sign-up returned ${signUp.status}`);
  }
  steps.push({
    id: "smoke-sign-up",
    ok: true,
    detail: "random user signed up",
  });

  const signIn = await fetchText(`${convexSiteUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const cookies = cookiesFrom(signIn.headers);
  if (signIn.status !== 200) {
    return fail("smoke-sign-in", `sign-in returned ${signIn.status}`);
  }
  if (!cookies) {
    return fail("smoke-sign-in", "sign-in issued no session cookie");
  }
  steps.push({
    id: "smoke-sign-in",
    ok: true,
    detail: "sign-in issued a session cookie",
  });

  const authed = await fetchText(`${baseUrl}/`, {
    headers: { Cookie: cookies },
    redirect: "manual",
  });
  if (authed.status !== 200) {
    return fail(
      "smoke-session",
      `authenticated GET / returned ${authed.status}`
    );
  }
  steps.push({
    id: "smoke-session",
    ok: true,
    detail: "session reaches / with 200",
  });
  return { version: SMOKE_VERSION, baseUrl, ok: true, steps };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const baseUrl = args.includes("--base-url")
    ? (args[args.indexOf("--base-url") + 1] ?? "http://localhost:3000")
    : "http://localhost:3000";
  const json = args.includes("--json");
  const report = await runSmoke(baseUrl);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const step of report.steps) {
      console.log(`${step.ok ? "✓" : "✗"} ${step.id}: ${step.detail}`);
    }
    console.log(report.ok ? "smoke:web: ok" : "smoke:web: failed");
  }
  process.exitCode = report.ok ? 0 : 1;
};

if (import.meta.main) {
  await main();
}
