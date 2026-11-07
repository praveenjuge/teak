#!/usr/bin/env bun
// The API and MCP smoke: checks a deployment's public API and MCP endpoints,
// and the legacy API subdomain's redirects. BASE_URL picks the deployment
// (production by default). `.github/workflows/api-smoke.yml` runs it.
import { pollUntil } from "../release/release-cli.ts";
import {
  legacyApiRedirects,
  mcpChallenge,
  PRODUCTION_SITE_URL,
  type Redirect,
  type Surface,
  surfaces,
} from "./production-surfaces.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Retries a request only when it never got an answer. */
const request = (fetch: Fetch, url: string, init?: RequestInit) =>
  pollUntil(
    () => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    {
      attempts: 4,
      intervalMs: 2000,
      timeoutMs: 120_000,
      // fetch throws only when no answer came back.
      retryOn: () => true,
    }
  );

export const checkSurface = async (
  fetch: Fetch,
  surface: Surface
): Promise<string | null> => {
  const response = await request(fetch, surface.url);
  const body = await response.text();
  if (response.status !== 200) {
    return `Expected 200 for ${surface.url}, got ${response.status}\n${body}`;
  }
  return surface.body.test(body)
    ? null
    : `Expected ${surface.url} body to match ${surface.body}\n${body}`;
};

export const checkMcpChallenge = async (
  fetch: Fetch,
  siteUrl: string
): Promise<string | null> => {
  const challenge = mcpChallenge(siteUrl);
  const response = await request(fetch, challenge.url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(challenge.body),
  });
  const header = response.headers.get("www-authenticate");
  if (response.status !== 401) {
    return `Expected 401 for ${challenge.url}, got ${response.status}`;
  }
  if (!header?.includes(challenge.metadata)) {
    return `WWW-Authenticate for ${challenge.url} did not reference ${challenge.metadata}: ${header}`;
  }
  return null;
};

export const checkRedirect = async (
  fetch: Fetch,
  { from, to }: Redirect
): Promise<string | null> => {
  const response = await request(fetch, from, { redirect: "manual" });
  const location = response.headers.get("location");
  if (response.status !== 308) {
    return `Expected 308 for ${from}, got ${response.status}`;
  }
  return location === to
    ? null
    : `Expected Location ${to} for ${from}, got ${location}`;
};

export const smoke = async (
  siteUrl: string,
  fetch: Fetch = globalThis.fetch
): Promise<string[]> => {
  const results = await Promise.all([
    ...surfaces(siteUrl)
      .filter((surface) => surface.group === "api")
      .map((surface) => checkSurface(fetch, surface)),
    checkMcpChallenge(fetch, siteUrl),
    ...legacyApiRedirects().map((redirect) => checkRedirect(fetch, redirect)),
  ]);
  return results.filter((failure): failure is string => failure !== null);
};

if (import.meta.main) {
  const siteUrl = (process.env.BASE_URL || PRODUCTION_SITE_URL).replace(
    /\/$/,
    ""
  );
  console.log(`Smoke base: ${siteUrl}`);
  const failures = await smoke(siteUrl);
  for (const failure of failures) {
    console.error(failure);
  }
  if (failures.length > 0) {
    process.exit(1);
  }
  console.log("API and MCP endpoints answer as expected.");
}
