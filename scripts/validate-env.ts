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

const ROOT = join(import.meta.dir, "..");
const WEB_ENV_PATH = join(ROOT, "apps/web/.env.local");

export const REQUIRED_WEB_ENV_KEYS = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
] as const;

export interface EnvIssue {
  hint: string;
  key: string;
  problem: "missing" | "invalid-url";
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

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const validateWebEnvContent = (content: string): EnvIssue[] => {
  const values = parseDotenv(content);
  const issues: EnvIssue[] = [];
  for (const key of REQUIRED_WEB_ENV_KEYS) {
    const value = values.get(key);
    if (value === undefined || value === "") {
      issues.push({
        key,
        problem: "missing",
        hint: `Add ${key} to apps/web/.env.local (bun run setup writes local defaults).`,
      });
      continue;
    }
    if (!isHttpUrl(value)) {
      issues.push({
        key,
        problem: "invalid-url",
        hint: `${key} must be an http(s) URL (received "${value}"). Expected local defaults http://127.0.0.1:3210 / http://127.0.0.1:3211.`,
      });
    }
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
  console.log("✓ web env: Convex URLs present and valid.");
};

if (import.meta.main) {
  main();
}
