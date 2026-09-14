#!/usr/bin/env bun

/**
 * Environment readiness checks for local development.
 *
 * Validates Bun, dependency lock consistency, Convex isolation, generated
 * files, capability groups, ports, and selected-target readiness. Reports
 * variable names and remediation only, never values.
 *
 * Usage: bun run doctor [--json] [--target <target>] [--profile <profile>]
 *
 * JSON output is `{ version: 1, ok, target, profile, checks }` with stable
 * check IDs. `ok` is false when any error-severity check fails; warnings
 * never fail the report.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseConvexEnvOutput } from "./check-cloudflare.ts";
import { auditFiles, listScannedFiles } from "./env-audit.ts";
import { isInstallStale, readConvexSelection } from "./setup.ts";
import { validateWebEnvContent } from "./validate-env.ts";

const ROOT = join(import.meta.dir, "..");
const CONVEX_PATH = join(ROOT, "packages/convex");

export const DOCTOR_VERSION = 1;

export const DOCTOR_TARGETS = [
  "web",
  "convex",
  "files",
  "extension",
  "desktop",
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
  "Usage: bun run doctor [--json] [--target web|convex|files|extension|desktop|mobile|cli|docs] [--profile local|e2e]";

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

export const isPortOccupied = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(true);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(false);
      });
    });
    server.listen(port, "127.0.0.1");
  });

const convexCommand = async (
  args: string[],
  timeoutMs = 25_000
): Promise<{ exitCode: number; stdout: string; stderr: string } | null> => {
  try {
    const proc = Bun.spawn(["bunx", "convex", ...args], {
      cwd: CONVEX_PATH,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill(9);
      } catch {}
    }, timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { exitCode: exitCode ?? 1, stdout, stderr };
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

export const checkBunVersion = (): DoctorCheck => {
  const packageJson = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  ) as { packageManager?: string };
  const pinned = packageJson.packageManager?.replace(/^bun@/, "");
  if (!pinned) {
    return {
      id: "bun-version",
      ok: false,
      severity: "error",
      detail: "packageManager is not pinned in package.json",
      remediation: ["Pin packageManager to bun@x.y.z"],
    };
  }
  const [major, minor] = Bun.version.split(".");
  const [pinnedMajor, pinnedMinor] = pinned.split(".");
  if (Bun.version === pinned) {
    return {
      detail: `Bun ${Bun.version} matches pinned ${pinned}`,
      id: "bun-version",
      ok: true,
      severity: "error",
    };
  }
  if (major === pinnedMajor && minor === pinnedMinor) {
    return {
      detail: `Bun ${Bun.version} drifts from pinned ${pinned} (patch only)`,
      id: "bun-version",
      ok: true,
      severity: "warn",
    };
  }
  return {
    detail: `Bun ${Bun.version} does not match pinned ${pinned}`,
    id: "bun-version",
    ok: false,
    remediation: [`Install Bun ${pinned} and re-run`],
    severity: "error",
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

const CAPABILITY_GROUPS: { label: string; names: string[] }[] = [
  { label: "Google", names: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  {
    label: "Apple",
    names: [
      "APPLE_CLIENT_ID",
      "APPLE_KEY_ID",
      "APPLE_PRIVATE_KEY",
      "APPLE_TEAM_ID",
    ],
  },
];

export const evaluateCapabilityGroups = (
  presence: Map<string, EnvPresence>
): { broken: string[]; unknown: boolean } => {
  const broken: string[] = [];
  let unknown = false;
  for (const group of CAPABILITY_GROUPS) {
    const states = group.names.map((name) => presence.get(name));
    if (states.some((state) => state === "unavailable" || !state)) {
      unknown = true;
      continue;
    }
    const found = group.names.filter((name) => presence.get(name) === "found");
    if (found.length > 0 && found.length < group.names.length) {
      const missing = group.names.filter((name) => !found.includes(name));
      broken.push(`${group.label} is partial (missing ${missing.join(", ")})`);
    }
  }
  return { broken, unknown };
};

export const checkCapabilityGroups = async (): Promise<DoctorCheck> => {
  const names = CAPABILITY_GROUPS.flatMap((group) => group.names);
  const presence = new Map<string, EnvPresence>(
    await Promise.all(
      names.map(async (name) => [name, await convexEnvPresence(name)] as const)
    )
  );
  const { broken, unknown } = evaluateCapabilityGroups(presence);
  if (broken.length > 0) {
    return {
      detail: broken.join("; "),
      id: "capability-groups",
      ok: false,
      remediation: [
        "Set the full group or remove it entirely; partial groups are invalid",
      ],
      severity: "error",
    };
  }
  if (unknown) {
    return {
      detail:
        "Convex deployment is unreachable; capability groups could not be verified",
      id: "capability-groups",
      ok: true,
      remediation: [
        "Run bunx convex login (or export CONVEX_AGENT_MODE=anonymous) and re-run",
      ],
      severity: "warn",
    };
  }
  return {
    detail: "Google and Apple capability groups are whole or absent",
    id: "capability-groups",
    ok: true,
    severity: "error",
  };
};

export const checkPorts = async (): Promise<DoctorCheck> => {
  const occupied: number[] = [];
  for (const port of [3000, 3001, 3210, 3211]) {
    if (await isPortOccupied(port)) {
      occupied.push(port);
    }
  }
  return occupied.length === 0
    ? {
        detail: "local ports 3000, 3001, 3210, 3211 are free",
        id: "ports",
        ok: true,
        severity: "warn",
      }
    : {
        detail: `ports in use: ${occupied.join(", ")} (a stack may already be running)`,
        id: "ports",
        ok: true,
        remediation: ["Stop the owning process or reuse the running stack"],
        severity: "warn",
      };
};

const E2E_REQUIRED = [
  "E2E_CONVEX_URL",
  "E2E_CONVEX_SITE_URL",
  "E2E_CLEANUP_TOKEN",
  "PROD_E2E_PASSWORD",
  "MAILPIT_URL",
  "E2E_EMAIL_DOMAIN",
];

export const checkE2EVars = (
  env: NodeJS.ProcessEnv = process.env
): DoctorCheck => {
  const missing = E2E_REQUIRED.filter((name) => !env[name]?.trim());
  return missing.length === 0
    ? {
        detail: "required E2E variables are present",
        id: "e2e-vars",
        ok: true,
        severity: "error",
      }
    : {
        detail: `missing E2E variables: ${missing.join(", ")}`,
        id: "e2e-vars",
        ok: false,
        remediation: [
          "Export the missing E2E_* variables or create .env.production-e2e.local",
        ],
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
      detail: "web Convex configuration is present and valid",
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
  if (target === "extension" || target === "desktop" || target === "mobile") {
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
            `Create apps/${target}/.env.local with the ${target === "mobile" ? "EXPO_PUBLIC" : "VITE_PUBLIC"}_CONVEX_* origins`,
          ],
          severity: "warn",
        };
  }
  return {
    detail: `${target} needs no local dotenv (defaults and flags apply)`,
    id,
    ok: true,
    severity: "error",
  };
};

export const runDoctor = async (
  target: DoctorTarget,
  profile: DoctorProfile
): Promise<DoctorReport> => {
  const checks: DoctorCheck[] = [
    checkBunVersion(),
    checkDependencyLock(),
    checkConvexIsolation(),
    checkConvexGenerated(),
    checkEnvAudit(),
    checkTargetReadiness(target),
    ...(profile === "e2e" ? [checkE2EVars()] : []),
    await checkConvexSiteUrl(),
    await checkCapabilityGroups(),
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
