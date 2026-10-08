#!/usr/bin/env bun
/**
 * Clean-container web session smoke (issue #407, Phase 5).
 *
 * Proves the WorkOS AuthKit gate of a locally running web app: anonymous
 * requests to `/` redirect to `/sign-in`, and a real WorkOS session reaches
 * `/`. The session comes from the headless flow in
 * ./lib/workos-test-session.ts: a throwaway verified WorkOS user signs in
 * with a random password and its tokens are sealed into the AuthKit cookie.
 * The user is always deleted afterwards. Reads ONLY the web target's declared
 * dotenv file. Reports status and names; emails, passwords, tokens and
 * cookies are never printed.
 *
 * SMOKE_WORKOS_CREDENTIALS says whether the WorkOS credentials in that file
 * are real: `present` (default) runs the authenticated check, `fork` skips it
 * because fork pull requests get no secrets, and `missing` fails it because
 * the repository secrets are expected but not set.
 *
 * Usage: bun run smoke:web [--base-url <url>] [--json]
 */

import { loadTargetEnv } from "./env-loader.ts";
import {
  cookieHeader,
  createWorkosTestSession,
  describeWorkosError,
} from "./lib/workos-test-session.ts";

export const SMOKE_VERSION = 2;

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

export type SmokeCredentials = "present" | "fork" | "missing";

export const parseSmokeCredentials = (
  value: string | undefined
): SmokeCredentials => {
  if (value === undefined || value === "" || value === "present") {
    return "present";
  }
  if (value === "fork" || value === "missing") {
    return value;
  }
  throw new Error(
    `SMOKE_WORKOS_CREDENTIALS must be present, fork or missing (received "${value}")`
  );
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** True when a response redirects to `path` on the app's own origin. */
export const redirectsTo = (
  status: number,
  location: string | null,
  baseUrl: string,
  path: string
): boolean => {
  if (!(REDIRECT_STATUSES.has(status) && location)) {
    return false;
  }
  const target = new URL(location, baseUrl);
  return target.origin === new URL(baseUrl).origin && target.pathname === path;
};

const fetchStatus = async (
  url: string,
  init: RequestInit = {}
): Promise<{ location: string | null; status: number }> => {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  await response.body?.cancel();
  return {
    location: response.headers.get("location"),
    status: response.status,
  };
};

const authenticatedStep = async (
  baseUrl: string,
  config: {
    apiKey: string;
    clientId: string;
    cookiePassword: string;
    redirectUri: string;
  }
): Promise<SmokeStep[]> => {
  let session: Awaited<ReturnType<typeof createWorkosTestSession>>;
  try {
    session = await createWorkosTestSession({ ...config, label: "smoke" });
  } catch (error) {
    return [
      {
        id: "smoke-workos-session",
        ok: false,
        detail: `creating the WorkOS user or signing in failed: ${describeWorkosError(error)}`,
      },
    ];
  }
  const steps: SmokeStep[] = [
    {
      id: "smoke-workos-session",
      ok: true,
      detail: "throwaway WorkOS user signed in with a password",
    },
  ];
  try {
    const authed = await fetchStatus(`${baseUrl}/`, {
      headers: { Cookie: cookieHeader(session.cookie) },
    });
    steps.push(
      authed.status === 200
        ? {
            id: "smoke-session",
            ok: true,
            detail: "session reaches / with 200",
          }
        : {
            id: "smoke-session",
            ok: false,
            detail: `authenticated GET / returned ${authed.status}${redirectsTo(authed.status, authed.location, baseUrl, "/sign-in") ? " (redirect to /sign-in: the session was rejected)" : ""}`,
          }
    );
  } catch (error) {
    steps.push({
      id: "smoke-session",
      ok: false,
      detail: `authenticated GET / failed: ${error instanceof Error ? error.name : "unknown error"}`,
    });
  } finally {
    try {
      await session.cleanup();
      steps.push({
        id: "smoke-workos-cleanup",
        ok: true,
        detail: "throwaway WorkOS user deleted",
      });
    } catch (error) {
      steps.push({
        id: "smoke-workos-cleanup",
        ok: false,
        detail: `deleting the throwaway WorkOS user failed: ${describeWorkosError(error)}`,
      });
    }
  }
  return steps;
};

export const runSmoke = async (
  baseUrl: string,
  credentials: SmokeCredentials = "present"
): Promise<SmokeReport> => {
  const steps: SmokeStep[] = [];
  const report = (): SmokeReport => ({
    version: SMOKE_VERSION,
    baseUrl,
    ok: steps.every((step) => step.ok),
    steps,
  });

  const loaded = loadTargetEnv("web", "local");
  const config = {
    apiKey: loaded.values.get("WORKOS_API_KEY") ?? "",
    clientId: loaded.values.get("WORKOS_CLIENT_ID") ?? "",
    cookiePassword: loaded.values.get("WORKOS_COOKIE_PASSWORD") ?? "",
    redirectUri: loaded.values.get("NEXT_PUBLIC_WORKOS_REDIRECT_URI") ?? "",
  };
  if (!Object.values(config).every(Boolean)) {
    steps.push({
      id: "smoke-config",
      ok: false,
      detail:
        "apps/web/.env.local is missing WorkOS sign-in values (run bun run setup --target web)",
    });
    return report();
  }
  steps.push({
    id: "smoke-config",
    ok: true,
    detail: "web sign-in config loaded",
  });

  const anonymous = await fetchStatus(`${baseUrl}/`);
  steps.push(
    redirectsTo(anonymous.status, anonymous.location, baseUrl, "/sign-in")
      ? {
          id: "smoke-auth-gate",
          ok: true,
          detail: "anonymous / redirects to /sign-in",
        }
      : {
          id: "smoke-auth-gate",
          ok: false,
          detail: `anonymous GET / returned ${anonymous.status} (expected a /sign-in redirect)`,
        }
  );

  if (credentials === "fork") {
    steps.push({
      id: "smoke-session",
      ok: true,
      detail: "skipped: fork pull requests get no WorkOS staging credentials",
    });
    return report();
  }
  if (credentials === "missing") {
    steps.push({
      id: "smoke-session",
      ok: false,
      detail:
        "WorkOS staging credentials are not configured: set the WORKOS_STAGING_CLIENT_ID and WORKOS_STAGING_API_KEY repository secrets",
    });
    return report();
  }
  steps.push(...(await authenticatedStep(baseUrl, config)));
  return report();
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const baseUrl = args.includes("--base-url")
    ? (args[args.indexOf("--base-url") + 1] ?? "http://localhost:3000")
    : "http://localhost:3000";
  const json = args.includes("--json");
  const report = await runSmoke(
    baseUrl,
    parseSmokeCredentials(process.env.SMOKE_WORKOS_CREDENTIALS)
  );
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
