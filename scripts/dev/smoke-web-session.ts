#!/usr/bin/env bun
import { loadTargetEnv } from "../env/env-loader.ts";
import {
  cookieHeader,
  createWorkosTestSession,
  describeWorkosError,
} from "../lib/workos-test-session.ts";
import { readDevWorkosApiKey } from "../setup/setup-workos.ts";

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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  const who = "throwaway WorkOS user";
  let session: Awaited<ReturnType<typeof createWorkosTestSession>>;
  try {
    session = await createWorkosTestSession({ ...config, label: "smoke" });
  } catch (error) {
    return [
      {
        id: "smoke-workos-session",
        ok: false,
        detail: `signing in as ${who} failed: ${describeWorkosError(error)}`,
      },
    ];
  }
  const steps: SmokeStep[] = [
    {
      id: "smoke-workos-session",
      ok: true,
      detail: `${who} signed in with a password`,
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

const webSettings = (): ReadonlyMap<string, string> =>
  loadTargetEnv("web").values;

export const runSmoke = async (baseUrl: string): Promise<SmokeReport> => {
  const steps: SmokeStep[] = [];
  const report = (): SmokeReport => ({
    version: SMOKE_VERSION,
    baseUrl,
    ok: steps.every((step) => step.ok),
    steps,
  });

  const values = webSettings();
  const config = {
    apiKey: await readDevWorkosApiKey(),
    clientId: values.get("WORKOS_CLIENT_ID") ?? "",
    cookiePassword: values.get("WORKOS_COOKIE_PASSWORD") ?? "",
    redirectUri: values.get("NEXT_PUBLIC_WORKOS_REDIRECT_URI") ?? "",
  };
  if (!Object.values(config).every(Boolean)) {
    steps.push({
      id: "smoke-config",
      ok: false,
      detail:
        "WorkOS sign-in values are missing: run bun run setup --target web, and check WORKOS_API_KEY on the dev deployment",
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

  steps.push(...(await authenticatedStep(baseUrl, config)));
  return report();
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const redirectUri = webSettings().get("NEXT_PUBLIC_WORKOS_REDIRECT_URI");
  const fallback = redirectUri
    ? new URL(redirectUri).origin
    : "http://localhost:3000";
  const baseUrl = args.includes("--base-url")
    ? (args[args.indexOf("--base-url") + 1] ?? fallback)
    : fallback;
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
