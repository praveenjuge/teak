#!/usr/bin/env bun
/**
 * Name-only audit of local dotenv state (issue #407, Phase 0).
 *
 * Scans the dotenv files owned by ./env-targets.ts plus legacy root dotenv
 * files. Reports NAMES only: deleted aliases, production selectors in local
 * profiles, credentials in the wrong scope, and stale keys. Values are read
 * only for shape checks (non-empty, `prod:` prefix) and never printed,
 * returned, or embedded in any finding.
 *
 * Usage: bun run scripts/dotenv-audit.ts [--json]
 */

import { join } from "node:path";
import {
  ENV_VAR_NAMES,
  getEnvSpec,
  isDeletedAlias,
  isPlatformVar,
  SECRET_VAR_NAMES,
} from "./env-contract.ts";
import { readDotenvFile } from "./env-loader.ts";
import { CONVEX_DOTENV_FILE, SUPPORTED_DOTENV_FILES } from "./env-targets.ts";

export const DOTENV_AUDIT_VERSION = 1;

const ROOT = join(import.meta.dir, "..");

/** Legacy ambient files Bun would load; never consumed by our commands. */
export const LEGACY_ROOT_DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
] as const;

/** Files whose profile legitimately holds production selectors. */
const E2E_SCOPE_FILES = new Set([
  ".env.e2e.local",
  "apps/web/.env.e2e.local",
  ".env.production-e2e.local",
]);

const WEB_BUILD_INPUT = "apps/web/.env.local";

export type DotenvFindingKind =
  | "deleted-alias"
  | "production-selector"
  | "wrong-scope"
  | "stale-key";

export interface DotenvFinding {
  detail: string;
  kind: DotenvFindingKind;
  name: string;
  path: string;
  severity: "error" | "warn";
}

const isE2ESecret = (name: string): boolean => {
  if (!SECRET_VAR_NAMES.has(name)) {
    return false;
  }
  return getEnvSpec(name)?.targets.includes("e2e") ?? false;
};

const isReleaseOnly = (name: string): boolean => {
  const spec = getEnvSpec(name);
  return (
    spec !== undefined &&
    spec.targets.length === 1 &&
    spec.targets[0] === "release"
  );
};

/** Shape-only: non-empty values select production for these names. */
const selectsProduction = (name: string, value: string): boolean => {
  if (value.trim().length === 0) {
    return false;
  }
  if (name === "CONVEX_DEPLOY_KEY") {
    return true;
  }
  return name === "CONVEX_DEPLOYMENT" && value.trim().startsWith("prod:");
};

const auditSupportedFile = (
  rel: string,
  root: string,
  findings: DotenvFinding[]
): void => {
  const parsed = readDotenvFile(join(root, rel));
  if (!parsed) {
    return;
  }
  const e2eScope = E2E_SCOPE_FILES.has(rel);
  for (const [name, value] of parsed.values) {
    if (isDeletedAlias(name)) {
      findings.push({
        kind: "deleted-alias",
        name,
        path: rel,
        severity: "error",
        detail: "deleted alias is still present in local dotenv state",
      });
      continue;
    }
    if (!e2eScope && selectsProduction(name, value)) {
      findings.push({
        kind: "production-selector",
        name,
        path: rel,
        severity: "error",
        detail:
          "production selector in a local-profile file; local bootstrap refuses it",
      });
      continue;
    }
    if (rel === WEB_BUILD_INPUT && isE2ESecret(name)) {
      findings.push({
        kind: "wrong-scope",
        name,
        path: rel,
        severity: "warn",
        detail:
          "E2E credential in the web build input; move it to apps/web/.env.e2e.local",
      });
      continue;
    }
    if (!e2eScope && isReleaseOnly(name)) {
      findings.push({
        kind: "wrong-scope",
        name,
        path: rel,
        severity: "warn",
        detail: "release-only credential in a local-profile file",
      });
      continue;
    }
    if (!(ENV_VAR_NAMES.has(name) || isPlatformVar(name))) {
      findings.push({
        kind: "stale-key",
        name,
        path: rel,
        severity: "warn",
        detail: "name is not in the environment contract",
      });
    }
  }
};

const auditLegacyRootFile = (
  rel: string,
  root: string,
  findings: DotenvFinding[]
): void => {
  const parsed = readDotenvFile(join(root, rel));
  if (!parsed) {
    return;
  }
  for (const [name, value] of parsed.values) {
    if (selectsProduction(name, value)) {
      findings.push({
        kind: "production-selector",
        name,
        path: rel,
        severity: "warn",
        detail:
          "production selector in a legacy root dotenv file (supported commands ignore this file, but other tools may not)",
      });
    }
  }
};

export const auditDotenv = (root: string = ROOT): DotenvFinding[] => {
  const findings: DotenvFinding[] = [];
  for (const rel of [...SUPPORTED_DOTENV_FILES, CONVEX_DOTENV_FILE]) {
    auditSupportedFile(rel, root, findings);
  }
  for (const rel of LEGACY_ROOT_DOTENV_FILES) {
    auditLegacyRootFile(rel, root, findings);
  }
  return findings.sort((a, b) =>
    `${a.path}:${a.name}:${a.kind}`.localeCompare(
      `${b.path}:${b.name}:${b.kind}`
    )
  );
};

export const hasDotenvErrors = (findings: DotenvFinding[]): boolean =>
  findings.some((finding) => finding.severity === "error");

export interface DotenvAuditReport {
  findings: DotenvFinding[];
  ok: boolean;
  version: number;
}

export const buildDotenvReport = (root: string = ROOT): DotenvAuditReport => {
  const findings = auditDotenv(root);
  return {
    version: DOTENV_AUDIT_VERSION,
    ok: !hasDotenvErrors(findings),
    findings,
  };
};

const main = (): void => {
  const report = buildDotenvReport();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.findings.length === 0) {
    console.log("dotenv-audit: ok (no local dotenv findings).");
  } else {
    for (const finding of report.findings) {
      console.log(
        `${finding.severity === "error" ? "✗" : "~"} ${finding.path}: ${finding.kind}:${finding.name} — ${finding.detail}`
      );
    }
    console.log(
      report.ok ? "dotenv-audit: warnings only." : "dotenv-audit: failing."
    );
  }
  process.exitCode = report.ok ? 0 : 1;
};

if (import.meta.main) {
  main();
}
