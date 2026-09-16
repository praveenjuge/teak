/**
 * Name-only environment contract for the Teak monorepo.
 *
 * Single source of truth for every operator-owned runtime, build, release,
 * and E2E variable: who owns it, which target consumes it, which profiles it
 * applies to, whether it is secret, how it validates, where it is provided,
 * and whether it is required. Entry tables live in
 * ./env-contract-entries-*.ts; types and the entry builder live in
 * ./env-contract-types.ts. Names and metadata only - never values.
 *
 * Automatic platform values (CI, GitHub Actions, Vercel/Git metadata, test
 * runner and framework injections) are listed in PLATFORM_EXACT /
 * PLATFORM_PATTERNS instead. Removed names live in DELETED_ALIASES so the
 * audit in ./env-audit.ts can fail if they return.
 */

import { BACKEND_ENTRIES } from "./env-contract-entries-backend.ts";
import { OPS_ENTRIES } from "./env-contract-entries-ops.ts";
import { SURFACE_ENTRIES } from "./env-contract-entries-surfaces.ts";
import type { EnvVarSpec } from "./env-contract-types.ts";

export const ENV_CONTRACT: EnvVarSpec[] = [
  ...BACKEND_ENTRIES,
  ...SURFACE_ENTRIES,
  ...OPS_ENTRIES,
];

/** Names removed by the typed-env cleanup. The audit fails if they return. */
export const DELETED_ALIASES = [
  "AUTH_ISSUER_URL",
  "NEXT_PUBLIC_R2_PUBLIC_ORIGIN",
  "NEXT_PUBLIC_R2_PUBLIC_URL",
  "NEXT_PUBLIC_R2_STORAGE_ORIGIN",
  "NEXT_PUBLIC_R2_STORAGE_URL",
  "NEXT_PUBLIC_R2_UPLOAD_ORIGIN",
  "NEXT_PUBLIC_R2_UPLOAD_URL",
  "PROD_API_URL",
  "PROD_APP_URL",
  "PROD_MCP_URL",
  "PROD_SITE_URL",
  "PUBLIC_API_URL",
  "PUBLIC_MCP_URL",
  "R2_PUBLIC_ORIGIN",
  "R2_PUBLIC_URL",
  "R2_STORAGE_ORIGIN",
  "R2_STORAGE_URL",
  "R2_UPLOAD_ORIGIN",
  "R2_UPLOAD_URL",
] as const;

/**
 * Automatic platform, tool, and framework values. Never operator-owned, so
 * never in the contract. Exact names only; prefix families live in
 * PLATFORM_PATTERNS.
 */
export const PLATFORM_EXACT = [
  "BROWSER",
  "CI",
  "GITHUB_ACTIONS",
  "CONVEX_CLOUD_URL",
  "CONVEX_DEPLOYMENT",
  "DEV",
  "EAS_BUILD",
  "EAS_BUILD_PROFILE",
  "EXPO_OS",
  "GH_TOKEN",
  "GITHUB_ACTIONS",
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_REF",
  "GITHUB_REF_NAME",
  "GITHUB_RUN_ID",
  "GITHUB_RUN_NUMBER",
  "GITHUB_SHA",
  "GITHUB_STEP_SUMMARY",
  "GITHUB_TOKEN",
  "HOME",
  "INIT_CWD",
  "MODE",
  "NEXT_RUNTIME",
  "NODE_BINARY",
  "NODE_ENV",
  "npm_lifecycle_event",
  "npm_package_version",
  "OLDPWD",
  "PATH",
  "PROD",
  "PWD",
  "RUNNER_ARCH",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "SHELL",
  "SSR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_REGION",
  "VERCEL_URL",
  "XDG_CONFIG_HOME",
] as const;

/** Prefix families owned by platforms and tools, matched case-sensitively. */
export const PLATFORM_PATTERNS = [
  /^EAS_/,
  /^EXPO_(?!PUBLIC_)/,
  /^GITHUB_/,
  /^MAIN_WINDOW_VITE_/,
  /^npm_/,
  /^PLAYWRIGHT_/,
  /^RUNNER_/,
  /^VERCEL_/,
] as const;

export const ENV_VAR_NAMES = new Set(ENV_CONTRACT.map((entry) => entry.name));

export const SECRET_VAR_NAMES = new Set(
  ENV_CONTRACT.filter((entry) => entry.secret).map((entry) => entry.name)
);

const DELETED_ALIAS_SET = new Set<string>(DELETED_ALIASES);
const PLATFORM_EXACT_SET = new Set<string>(PLATFORM_EXACT);

export const isDeletedAlias = (name: string): boolean =>
  DELETED_ALIAS_SET.has(name);

export const isPlatformVar = (name: string): boolean =>
  PLATFORM_EXACT_SET.has(name) ||
  PLATFORM_PATTERNS.some((pattern) => pattern.test(name));

export const getEnvSpec = (name: string): EnvVarSpec | undefined =>
  ENV_CONTRACT.find((entry) => entry.name === name);
