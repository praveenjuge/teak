#!/usr/bin/env bun
/**
 * Fail-fast validation for local web env.
 *
 * Pure validators are exported for unit tests and reuse by doctor/dev.
 * CLI mode checks apps/web/.env.local and exits non-zero with fix hints.
 * Usage: bun run scripts/validate-env.ts [--check]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkosWebConfig } from "../apps/web/src/lib/workos-config";

const ROOT = join(import.meta.dir, "..");
const WEB_ENV_PATH = join(ROOT, "apps/web/.env.local");

export const REQUIRED_WEB_ENV_KEYS = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
] as const;

export const REQUIRED_WEB_AUTH_KEYS = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
] as const;

export interface EnvIssue {
  hint: string;
  key: string;
  problem: "missing" | "invalid-url" | "invalid-auth-config";
}

const parseDotenv = (content: string): Map<string, string> => {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    if (!key || values.has(key)) {
      continue;
    }
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    values.set(key, value);
  }
  return values;
};

const EXPAND_ESCAPED_DOLLAR = "__TEAK_ESCAPED_DOLLAR__";

export const expandEnvReferences = (
  value: string,
  lookup: (name: string) => string | undefined
): string => {
  const unescaped = value.replace(/\\\$/g, EXPAND_ESCAPED_DOLLAR);
  const expanded = unescaped.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (_, braced: string | undefined, plain: string | undefined) =>
      lookup(braced ?? plain ?? "") ?? ""
  );
  return expanded.replaceAll(EXPAND_ESCAPED_DOLLAR, "$");
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const validateWebEnvContent = (
  content: string,
  env: NodeJS.ProcessEnv = process.env
): EnvIssue[] => {
  const values = parseDotenv(content);
  const lookup = (name: string): string | undefined =>
    values.get(name) ?? env[name];
  const issues: EnvIssue[] = [];
  for (const key of REQUIRED_WEB_ENV_KEYS) {
    const raw = values.get(key);
    if (raw === undefined || raw === "") {
      issues.push({
        hint: `Add ${key} to apps/web/.env.local (bun run setup writes local defaults).`,
        key,
        problem: "missing",
      });
      continue;
    }
    // Next.js expands $VARIABLE / ${VARIABLE} references before assigning
    // process.env; validate the expanded value so indirection is accepted.
    const value = expandEnvReferences(raw, lookup);
    if (!isHttpUrl(value)) {
      issues.push({
        key,
        problem: "invalid-url",
        hint: `${key} must be an http(s) URL (received "${value}"). Expected local defaults http://127.0.0.1:3210 / http://127.0.0.1:3211.`,
      });
    }
  }
  // WorkOS AuthKit is the only sign-in provider, so the web server always
  // needs its credentials. The web reader is the single source of the rules.
  const missingAuth = REQUIRED_WEB_AUTH_KEYS.filter((key) => !lookup(key));
  for (const key of missingAuth) {
    issues.push({
      hint: `Add ${key} to apps/web/.env.local (bun run setup writes it from your WorkOS staging or development environment).`,
      key,
      problem: "missing",
    });
  }
  if (missingAuth.length > 0) {
    return issues;
  }
  const authEnvironment = Object.fromEntries(
    [...REQUIRED_WEB_AUTH_KEYS, "WORKOS_ISSUER", "NODE_ENV"].map((key) => [
      key,
      expandEnvReferences(lookup(key) ?? "", lookup),
    ])
  );
  try {
    readWorkosWebConfig(authEnvironment);
  } catch {
    issues.push({
      key: "WORKOS_CLIENT_ID",
      problem: "invalid-auth-config",
      hint: "Configure the same development WorkOS client/API key as the Convex deployment, a cookie password of at least 32 characters, and the app origin + /callback. An issuer override must match the client ID. Never use production credentials locally.",
    });
  }
  return issues;
};

export const formatEnvIssues = (issues: EnvIssue[]): string =>
  issues
    .map((issue) => `✗ ${issue.key}: ${issue.problem} — ${issue.hint}`)
    .join("\n");

const main = (): void => {
  if (!existsSync(WEB_ENV_PATH)) {
    console.error("✗ apps/web/.env.local missing — run: bun run setup");
    process.exitCode = 1;
    return;
  }
  const issues = validateWebEnvContent(readFileSync(WEB_ENV_PATH, "utf-8"));
  if (issues.length > 0) {
    console.error(formatEnvIssues(issues));
    process.exitCode = 1;
    return;
  }
  console.log("✓ web env: Convex URLs and WorkOS sign-in present and valid.");
};

if (import.meta.main) {
  main();
}
