#!/usr/bin/env bun

/**
 * Environment readiness checks for local development.
 *
 * Validates Bun, dependency lock consistency, Convex isolation, generated
 * files, WorkOS sign-in credentials, ports, and selected-target readiness. Reports
 * variable names and remediation only, never values.
 *
 * Usage: bun run doctor [--json] [--target <target>] [--profile <profile>]
 *
 * JSON output is `{ version: 1, ok, target, profile, checks }` with stable
 * check IDs. `ok` is false when any error-severity check fails; warnings
 * never fail the report.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMULATOR_CLIENT_ID,
  EMULATOR_WEB_ENV,
} from "../packages/tests/src/emulator/config.ts";
import {
  checkBunVersion,
  checkNodeVersion,
  inferLanHost,
  isInstallStale,
  isPortOccupied,
  readConvexSelection,
} from "./capabilities.ts";
import { parseConvexEnvOutput } from "./check-cloudflare.ts";
import { auditDotenv } from "./dotenv-audit.ts";
import { auditFiles, listScannedFiles } from "./env-audit.ts";
import { readDotenvFile } from "./env-loader.ts";
import { runCommand } from "./proc.ts";
import { validateWebEnvContent } from "./validate-env.ts";
import { resolveWorktree } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");
const CONVEX_PATH = join(ROOT, "packages/convex");

export const DOCTOR_VERSION = 1;

export const DOCTOR_TARGETS = [
  "web",
  "convex",
  "files",
  "extension",
  "mobile",
  "cli",
  "docs",
] as const;
export type DoctorTarget = (typeof DOCTOR_TARGETS)[number];

export const DOCTOR_PROFILES = ["local", "e2e"] as const;
export type DoctorProfile = (typeof DOCTOR_PROFILES)[number];

export type DoctorSeverity = "error" | "warn";

export interface DoctorCheck {
  detail?: string;
  id: string;
  ok: boolean;
  remediation?: string[];
  severity: DoctorSeverity;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  profile: DoctorProfile;
  target: DoctorTarget;
  version: number;
}

export interface DoctorOptions {
  json: boolean;
  profile: DoctorProfile;
  target: DoctorTarget;
}

export const parseDoctorArgs = (argv: string[]): DoctorOptions => {
  let json = false;
  let target: DoctorTarget = "web";
  let profile: DoctorProfile = "local";
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--target") {
      const value = args[++i];
      if (!(DOCTOR_TARGETS as readonly string[]).includes(value ?? "")) {
        throw new Error(
          `Unknown --target "${value ?? ""}" (expected ${DOCTOR_TARGETS.join(", ")})`
        );
      }
      target = value as DoctorTarget;
    } else if (arg === "--profile") {
      const value = args[++i];
      if (!(DOCTOR_PROFILES as readonly string[]).includes(value ?? "")) {
        throw new Error(
          `Unknown --profile "${value ?? ""}" (expected ${DOCTOR_PROFILES.join(", ")})`
        );
      }
      profile = value as DoctorProfile;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else {
      throw new Error(
        `Unknown argument "${arg}" (usage: bun run doctor [--json] [--target <target>] [--profile <profile>])`
      );
    }
    i++;
  }
  return { json, profile, target };
};

export const DOCTOR_USAGE =
  "Usage: bun run doctor [--json] [--target web|convex|files|extension|mobile|cli|docs] [--profile local|e2e]";

export const findMissingKeys = (content: string, keys: string[]): string[] => {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    values.set(key.trim(), rest.join("=").trim());
  }
  return keys.filter((key) => {
    const value = values.get(key);
    if (value === undefined) {
      return true;
    }
    return value.replace(/^['"]|['"]$/g, "").length === 0;
  });
};

const convexCommand = async (
  args: string[],
  timeoutMs = 25_000
): Promise<{ exitCode: number; stdout: string; stderr: string } | null> => {
  try {
    return await runCommand(["bunx", "convex", ...args], {
      cwd: CONVEX_PATH,
      timeoutMs,
    });
  } catch {
    return null;
  }
};

type EnvPresence = "found" | "missing" | "unavailable";

const convexEnvPresence = async (name: string): Promise<EnvPresence> => {
  const result = await convexCommand(["env", "get", name]);
  if (!result) {
    return "unavailable";
  }
  const parsed = parseConvexEnvOutput(
    result.stdout,
    result.stderr,
    result.exitCode
  );
  // Presence only: values are dropped immediately and never reported.
  if (parsed.status === "found") {
    return "found";
  }
  return parsed.status === "missing" ? "missing" : "unavailable";
};

export const checkDotenvHygiene = (): DoctorCheck => {
  const findings = auditDotenv(ROOT);
  if (findings.length === 0) {
    return {
      detail: "local dotenv state is clean",
      id: "dotenv-hygiene",
      ok: true,
      severity: "warn",
    };
  }
  const errors = findings.filter((finding) => finding.severity === "error");
  const sample = findings
    .slice(0, 3)
    .map((finding) => `${finding.path}:${finding.name}`)
    .join(", ");
  return {
    detail: `${findings.length} local dotenv finding(s) (${errors.length} error): ${sample}${findings.length > 3 ? ", ..." : ""}`,
    id: "dotenv-hygiene",
    ok: true,
    remediation: [
      "Run bun run scripts/dotenv-audit.ts and clean up the named keys",
    ],
    severity: "warn",
  };
};

export const checkDependencyLock = (): DoctorCheck =>
  isInstallStale(ROOT)
    ? {
        detail: "node_modules is missing or older than bun.lock",
        id: "deps-lock",
        ok: false,
        remediation: ["Run bun run setup (it owns installation)"],
        severity: "error",
      }
    : {
        detail: "node_modules is present and newer than bun.lock",
        id: "deps-lock",
        ok: true,
        severity: "error",
      };

export const checkConvexIsolation = (): DoctorCheck => {
  if (process.env.CONVEX_DEPLOY_KEY?.trim()) {
    return {
      detail: "CONVEX_DEPLOY_KEY is set and would select production",
      id: "convex-isolation",
      ok: false,
      remediation: [
        "Unset CONVEX_DEPLOY_KEY for local work; production access is never the local default",
      ],
      severity: "error",
    };
  }
  const selection = readConvexSelection();
  if (selection.deployment?.startsWith("prod:")) {
    return {
      detail: `CONVEX_DEPLOYMENT selects production (${selection.deployment})`,
      id: "convex-isolation",
      ok: false,
      remediation: [
        "Point CONVEX_DEPLOYMENT at an isolated development deployment",
      ],
      severity: "error",
    };
  }
  return {
    detail: selection.deployment
      ? `isolated deployment ${selection.deployment} (from ${selection.source})`
      : "no deployment selected yet; setup will provision an isolated one",
    id: "convex-isolation",
    ok: true,
    severity: "error",
  };
};

export const checkConvexGenerated = (): DoctorCheck => {
  const generated = ["server.js", "server.d.ts", "api.d.ts"].map((file) =>
    join(CONVEX_PATH, "_generated", file)
  );
  const missing = generated.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    return {
      detail: `missing generated files: ${missing.map((file) => file.split("/").pop()).join(", ")}`,
      id: "convex-generated",
      ok: false,
      remediation: ["Run bun run setup (it runs convex dev --once)"],
      severity: "error",
    };
  }
  const empty = generated.filter(
    (file) => readFileSync(file, "utf-8").trim().length === 0
  );
  if (empty.length > 0) {
    return {
      detail: `empty generated files: ${empty.map((file) => file.split("/").pop()).join(", ")}`,
      id: "convex-generated",
      ok: false,
      remediation: ["Run bunx convex codegen in packages/convex"],
      severity: "error",
    };
  }
  return {
    detail: "Convex generated bindings are present",
    id: "convex-generated",
    ok: true,
    severity: "error",
  };
};

export const checkEnvAudit = (): DoctorCheck => {
  const files = new Map<string, string>();
  for (const rel of listScannedFiles(ROOT)) {
    files.set(rel, readFileSync(join(ROOT, rel), "utf-8"));
  }
  const findings = auditFiles(files);
  if (findings.length === 0) {
    return {
      detail: "environment contract audit passed",
      id: "env-audit",
      ok: true,
      severity: "error",
    };
  }
  const sample = findings
    .slice(0, 5)
    .map((finding) => `${finding.kind}:${finding.name}`)
    .join(", ");
  return {
    detail: `${findings.length} environment finding(s) (${sample}${findings.length > 5 ? ", ..." : ""})`,
    id: "env-audit",
    ok: false,
    remediation: ["Run bun run scripts/env-audit.ts and fix each finding"],
    severity: "error",
  };
};

export const checkConvexSiteUrl = async (): Promise<DoctorCheck> => {
  const presence = await convexEnvPresence("SITE_URL");
  if (presence === "found") {
    return {
      detail: "SITE_URL is set on the selected deployment",
      id: "convex-site-url",
      ok: true,
      severity: "error",
    };
  }
  if (presence === "missing") {
    return {
      detail: "SITE_URL is missing on the selected deployment",
      id: "convex-site-url",
      ok: false,
      remediation: ["Run bun run setup (it configures local SITE_URL)"],
      severity: "error",
    };
  }
  return {
    detail: "Convex deployment is unreachable; SITE_URL could not be verified",
    id: "convex-site-url",
    ok: true,
    remediation: [
      "Run bunx convex login (or export CONVEX_AGENT_MODE=anonymous) and re-run",
    ],
    severity: "warn",
  };
};

const WORKOS_DEPLOYMENT_VARS = ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"];

/** WorkOS AuthKit is the only sign-in provider, so its credentials are required. */
export const evaluateWorkosPresence = (
  presence: Map<string, EnvPresence>
): DoctorCheck => {
  const missing = WORKOS_DEPLOYMENT_VARS.filter(
    (name) => presence.get(name) === "missing"
  );
  if (missing.length > 0) {
    return {
      detail: `sign-in is not configured: ${missing.join(", ")} missing on the selected deployment`,
      id: "convex-workos",
      ok: false,
      remediation: [
        "Export WORKOS_CLIENT_ID and WORKOS_API_KEY from a WorkOS staging or development environment (never production) and re-run bun run setup",
      ],
      severity: "error",
    };
  }
  if (WORKOS_DEPLOYMENT_VARS.some((name) => presence.get(name) !== "found")) {
    return {
      detail:
        "Convex deployment is unreachable; WorkOS credentials could not be verified",
      id: "convex-workos",
      ok: true,
      remediation: [
        "Run bunx convex login (or export CONVEX_AGENT_MODE=anonymous) and re-run",
      ],
      severity: "warn",
    };
  }
  return {
    detail:
      "WORKOS_CLIENT_ID and WORKOS_API_KEY are set on the selected deployment",
    id: "convex-workos",
    ok: true,
    severity: "error",
  };
};

export const checkConvexWorkos = async (): Promise<DoctorCheck> =>
  evaluateWorkosPresence(
    new Map(
      await Promise.all(
        WORKOS_DEPLOYMENT_VARS.map(
          async (name) => [name, await convexEnvPresence(name)] as const
        )
      )
    )
  );

export const checkPorts = async (): Promise<DoctorCheck> => {
  const worktree = await resolveWorktree(ROOT);
  const own = worktree.namespaced
    ? [worktree.web, worktree.docs]
    : [worktree.web, worktree.docs, worktree.convex, worktree.convexSite];
  const occupied: number[] = [];
  for (const port of own) {
    if (await isPortOccupied(port)) {
      occupied.push(port);
    }
  }
  const scope = worktree.namespaced
    ? `worktree ${worktree.namespace} (convex is remote)`
    : "main checkout";
  return occupied.length === 0
    ? {
        detail: `local ports ${own.join(", ")} are free (${scope})`,
        id: "ports",
        ok: true,
        severity: "warn",
      }
    : {
        detail: `ports in use: ${occupied.join(", ")} (a stack may already be running; ${scope})`,
        id: "ports",
        ok: true,
        remediation: ["Stop the owning process or reuse the running stack"],
        severity: "warn",
      };
};

// The e2e stack is the web app wired to the WorkOS emulator by setup.
export const checkE2EStack = (
  web: ReadonlyMap<string, string> | undefined
): DoctorCheck => {
  const expected: Record<string, string> = {
    WORKOS_CLIENT_ID: EMULATOR_CLIENT_ID,
    ...EMULATOR_WEB_ENV,
  };
  const wrong = Object.keys(expected).filter(
    (name) => web?.get(name) !== expected[name]
  );
  return wrong.length === 0
    ? {
        detail: "apps/web/.env.local points at the WorkOS emulator",
        id: "e2e-stack",
        ok: true,
        severity: "error",
      }
    : {
        detail: `apps/web/.env.local is not wired to the WorkOS emulator: ${wrong.join(", ")}`,
        id: "e2e-stack",
        ok: false,
        remediation: ["Run bun run setup --target e2e"],
        severity: "error",
      };
};

export const checkTargetReadiness = (target: DoctorTarget): DoctorCheck => {
  const id = "target-readiness";
  if (target === "web") {
    const path = join(ROOT, "apps/web/.env.local");
    if (!existsSync(path)) {
      return {
        detail: "apps/web/.env.local is missing",
        id,
        ok: false,
        remediation: ["Run bun run setup to derive it"],
        severity: "error",
      };
    }
    const issues = validateWebEnvContent(readFileSync(path, "utf-8"));
    if (issues.length > 0) {
      return {
        detail: `apps/web/.env.local is invalid: ${issues.map((issue) => `${issue.key} (${issue.problem})`).join("; ")}`,
        id,
        ok: false,
        remediation: [
          "Fix the listed keys or delete the file and re-run bun run setup",
        ],
        severity: "error",
      };
    }
    return {
      detail: "web Convex and WorkOS configuration is present and valid",
      id,
      ok: true,
      severity: "error",
    };
  }
  if (target === "convex") {
    return existsSync(join(CONVEX_PATH, "convex.config.ts")) &&
      existsSync(join(CONVEX_PATH, "_generated", "server.js"))
      ? {
          detail: "convex config and generated bindings are present",
          id,
          ok: true,
          severity: "error",
        }
      : {
          detail: "convex config or generated bindings are missing",
          id,
          ok: false,
          remediation: ["Run bun run setup"],
          severity: "error",
        };
  }
  if (target === "files") {
    if (!existsSync(join(ROOT, "apps/files-worker/wrangler.jsonc"))) {
      return {
        detail: "files worker wrangler.jsonc is missing",
        id,
        ok: false,
        remediation: ["Restore apps/files-worker/wrangler.jsonc"],
        severity: "error",
      };
    }
    return existsSync(join(ROOT, "apps/files-worker/.dev.vars"))
      ? {
          detail: "files worker config and local dev vars are present",
          id,
          ok: true,
          severity: "error",
        }
      : {
          detail: "files worker .dev.vars is missing (FILES_SIGNING_SECRET)",
          id,
          ok: true,
          remediation: ["Run bun run sync:cloudflare-dev"],
          severity: "warn",
        };
  }
  if (target === "extension") {
    const path = join(ROOT, `apps/${target}/.env.local`);
    return existsSync(path)
      ? {
          detail: `${target} local dotenv is present`,
          id,
          ok: true,
          severity: "error",
        }
      : {
          detail: `${target} .env.local is missing (shell-provided values still work)`,
          id,
          ok: true,
          remediation: [
            `Run bun run setup --target ${target} to derive VITE_PUBLIC_CONVEX_*`,
          ],
          severity: "warn",
        };
  }
  if (target === "mobile") {
    const path = join(ROOT, "apps/mobile/.env.local");
    const lan = inferLanHost();
    const hostDetail = lan
      ? `simulators use loopback; physical devices reach this host at ${lan}`
      : "no LAN address inferred: simulators work, physical devices need this host on a reachable network";
    if (!existsSync(path)) {
      return {
        detail: `mobile .env.local is missing; ${hostDetail}`,
        id,
        ok: true,
        remediation: [
          "Run bun run setup --target mobile-simulator to derive EXPO_PUBLIC_CONVEX_*",
          ...(lan ? [] : ["Join a LAN and re-run, or use a simulator"]),
        ],
        severity: "warn",
      };
    }
    return {
      detail: `mobile local dotenv is present; ${hostDetail}`,
      id,
      ok: true,
      ...(lan
        ? { severity: "error" as const }
        : {
            severity: "warn" as const,
            remediation: ["Join a LAN and re-run, or use a simulator"],
          }),
    };
  }
  return {
    detail: `${target} needs no local dotenv (defaults and flags apply)`,
    id,
    ok: true,
    severity: "error",
  };
};

/** Targets that never consume a Convex deployment; backend checks are skipped for them. */
const NON_CONVEX_TARGETS: ReadonlySet<DoctorTarget> = new Set([
  "cli",
  "docs",
  "files",
]);

export const needsConvexChecks = (target: DoctorTarget): boolean =>
  !NON_CONVEX_TARGETS.has(target);

export const runDoctor = async (
  target: DoctorTarget,
  profile: DoctorProfile
): Promise<DoctorReport> => {
  const needsConvex = needsConvexChecks(target);
  const [siteUrlCheck, workosCheck] = needsConvex
    ? await Promise.all([checkConvexSiteUrl(), checkConvexWorkos()])
    : [null, null];
  const checks: DoctorCheck[] = [
    checkBunVersion(),
    await checkNodeVersion(),
    checkDependencyLock(),
    ...(needsConvex ? [checkConvexIsolation(), checkConvexGenerated()] : []),
    checkEnvAudit(),
    checkDotenvHygiene(),
    checkTargetReadiness(target),
    ...(profile === "e2e"
      ? [
          checkE2EStack(
            readDotenvFile(join(ROOT, "apps/web/.env.local"))?.values
          ),
        ]
      : []),
    ...(siteUrlCheck ? [siteUrlCheck] : []),
    ...(workosCheck ? [workosCheck] : []),
    await checkPorts(),
  ];
  return {
    checks,
    ok: !checks.some((check) => !check.ok && check.severity === "error"),
    profile,
    target,
    version: DOCTOR_VERSION,
  };
};

const printHuman = (report: DoctorReport): void => {
  console.log(
    `\nTeak doctor (target: ${report.target}, profile: ${report.profile})`
  );
  for (const check of report.checks) {
    let mark = "✗";
    if (check.ok) {
      mark = check.severity === "warn" ? "~" : "✓";
    }
    console.log(`  ${mark} ${check.id}: ${check.detail ?? ""}`);
    for (const line of check.remediation ?? []) {
      console.log(`      → ${line}`);
    }
  }
  console.log(report.ok ? "\ndoctor: ok" : "\ndoctor: failing checks above");
};

const main = async (): Promise<void> => {
  let options: DoctorOptions;
  try {
    options = parseDoctorArgs(process.argv);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(DOCTOR_USAGE);
      return;
    }
    throw error;
  }
  const report = await runDoctor(options.target, options.profile);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  process.exitCode = report.ok ? 0 : 1;
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `doctor failed: ${error instanceof Error ? error.message : String(error)}\n${DOCTOR_USAGE}`
    );
    process.exitCode = 1;
  }
}
