#!/usr/bin/env bun
/**
 * Idempotent local bootstrap for agents and developers.
 *
 * 1. Check the Bun and Node versions pinned by package.json.
 * 2. Run `bun ci` when node_modules is stale.
 * 3. Select the shared cloud dev deployment (scripts/dev-deployment.ts),
 *    reached with your Convex login or a cloud session's dev deploy key, and
 *    refuse any production or other deployment.
 * 4. Read the WorkOS staging credentials the web app needs from the dev
 *    deployment. Setup never writes deployment variables.
 * 5. Derive the target's ignored local configuration from canonical facts.
 *    Setup never overwrites a value a person set, but refreshes generated
 *    values (loopback URLs from an earlier local stack, synced credentials).
 *
 * Never uses production, Apple, Cloudflare, billing, or release credentials.
 * Every step is check-then-act, so re-running setup changes nothing once the
 * tree is ready. `--check` reports without changing state; `--json` emits a
 * stable machine-readable report with capabilities.
 *
 * Usage: bun run setup [--target <target>] [--convex cloud|skip] [--check] [--json]
 */

import { join } from "node:path";
import {
  type Capabilities,
  checkRuntimeVersion,
  inferLanHost,
  isInstallStale,
  markInstallFresh,
  planCapabilities,
  readNodeVersion,
  readPinnedVersions,
} from "./capabilities.ts";
import { DEV_DEPLOYMENT_URLS } from "./dev-deployment.ts";
import { generateAliasValues } from "./env-aliases.ts";
import {
  type ConvexMode,
  getTargetSpec,
  isSupportedTarget,
  type SupportedTarget,
} from "./env-targets.ts";
import { runCommand } from "./proc.ts";
import { setupDevDeployment } from "./setup-deployment.ts";
import { ensureDerivedEnv, ensureWebEnv } from "./setup-derived-env.ts";
import type { WorkosCredentialName } from "./setup-workos.ts";
import { resolveWorktree, type WorktreePorts } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");
const WEB_ENV_PATH = join(ROOT, "apps/web/.env.local");
const EXTENSION_ENV_PATH = join(ROOT, "apps/extension/.env.local");
const MOBILE_ENV_PATH = join(ROOT, "apps/mobile/.env.local");

export const requiredBunVersion = (packageManager: string): string => {
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager.trim());
  if (!match) {
    throw new Error(
      `Unsupported packageManager "${packageManager}" (expected bun@x.y.z)`
    );
  }
  return match[1];
};

export const checkBunVersion = (
  actual: string,
  required: string
): "ok" | "warn" | "mismatch" => checkRuntimeVersion(actual, required);

export const SETUP_VERSION = 1;

export interface SetupCheck {
  detail?: string;
  id: string;
  ok: boolean;
  remediation?: string[];
  severity: "error" | "warn";
}

export interface SetupOptions {
  check: boolean;
  convex: ConvexMode | null;
  json: boolean;
  target: string;
}

export interface SetupReport {
  capabilities?: Capabilities;
  checks: SetupCheck[];
  convex: string;
  mode: "check" | "run";
  ok: boolean;
  profile: string;
  target: string;
  version: number;
  /** WorkOS staging, through the dev deployment; null when the target needs no deployment. */
  workos: "staging" | null;
  worktree: WorktreePorts | null;
}

export const SETUP_USAGE =
  "Usage: bun run setup [--target web|docs|cli|extension|mobile-simulator|mobile-device|files-worker] [--convex cloud|skip] [--check] [--json]";

const CONVEX_MODES: readonly string[] = ["cloud", "skip"];

export const parseSetupArgs = (argv: string[]): SetupOptions => {
  let target = "web";
  let convex: ConvexMode | null = null;
  let check = false;
  let json = false;
  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--target") {
      const value = args[++i];
      if (!value) {
        throw new Error("Missing value for --target");
      }
      target = value;
    } else if (arg === "--convex") {
      const value = args[++i];
      if (!(value && CONVEX_MODES.includes(value))) {
        throw new Error(
          `Unknown --convex "${value ?? ""}" (expected cloud, skip)`
        );
      }
      convex = value as ConvexMode;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("help");
    } else {
      throw new Error(`Unknown argument "${arg}" (${SETUP_USAGE})`);
    }
    i++;
  }
  return { target, convex, check, json };
};

export const resolveSetupConvex = (
  target: SupportedTarget,
  explicit: ConvexMode | null
): ConvexMode => explicit ?? getTargetSpec(target).defaultConvex;

interface DerivedFilePlan {
  keys: string[];
  path: string;
}

const WEB_PLAN: DerivedFilePlan = {
  path: WEB_ENV_PATH,
  keys: [
    "NEXT_PUBLIC_CONVEX_URL",
    "NEXT_PUBLIC_CONVEX_SITE_URL",
    "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  ],
};

const DERIVED_FILE_PLANS: Record<SupportedTarget, DerivedFilePlan[]> = {
  web: [WEB_PLAN],
  docs: [],
  cli: [],
  extension: [
    {
      path: EXTENSION_ENV_PATH,
      keys: ["VITE_PUBLIC_CONVEX_URL", "VITE_PUBLIC_CONVEX_SITE_URL"],
    },
  ],
  "mobile-simulator": [
    {
      path: MOBILE_ENV_PATH,
      keys: ["EXPO_PUBLIC_CONVEX_URL", "EXPO_PUBLIC_CONVEX_SITE_URL"],
    },
  ],
  "mobile-device": [
    {
      path: MOBILE_ENV_PATH,
      keys: ["EXPO_PUBLIC_CONVEX_URL", "EXPO_PUBLIC_CONVEX_SITE_URL"],
    },
  ],
  "files-worker": [],
};

const reportWith = (
  partial: Partial<SetupReport> & { checks: SetupCheck[] }
): SetupReport => ({
  version: SETUP_VERSION,
  target: "web",
  convex: "cloud",
  profile: "local",
  mode: "run",
  workos: null,
  worktree: null,
  ...partial,
  ok: !partial.checks.some((check) => !check.ok && check.severity === "error"),
});

/**
 * Steps 1 and 2: the pinned runtimes, and packages installed with `bun ci`
 * when node_modules is stale. The E2E suite's runner uses them too.
 */
export const prepareCheckout = async (
  root: string,
  checkOnly: boolean
): Promise<{ checks: SetupCheck[]; ok: boolean }> => {
  const checks: SetupCheck[] = [];
  const failed = (check: SetupCheck) => ({
    checks: [...checks, check],
    ok: false,
  });
  let pinned: { bun: string; node: string };
  try {
    pinned = readPinnedVersions(root);
  } catch (error) {
    return failed({
      id: "setup-runtime-pins",
      ok: false,
      severity: "error",
      detail: error instanceof Error ? error.message : String(error),
      remediation: ["Restore packageManager and engines.node in package.json"],
    });
  }

  const bunStatus = checkRuntimeVersion(Bun.version, pinned.bun);
  checks.push({
    id: "setup-runtime-bun",
    ok: bunStatus !== "mismatch",
    severity: "error",
    detail:
      bunStatus === "ok"
        ? `Bun ${Bun.version} matches pinned ${pinned.bun}`
        : `Bun ${Bun.version} ${bunStatus === "warn" ? `drifts from pinned ${pinned.bun} (patch only)` : `does not match pinned ${pinned.bun}`}`,
    ...(bunStatus === "mismatch"
      ? { remediation: [`Install Bun ${pinned.bun} and re-run`] }
      : {}),
  });
  const nodeActual = await readNodeVersion();
  const nodeStatus =
    nodeActual === null
      ? "missing"
      : checkRuntimeVersion(nodeActual, pinned.node);
  const nodeLabel = nodeActual ? `v${nodeActual}` : "missing";
  let nodeDetail = `Node ${nodeLabel} does not match pinned ${pinned.node}`;
  if (nodeStatus === "ok") {
    nodeDetail = `Node ${nodeLabel} matches pinned ${pinned.node}`;
  } else if (nodeStatus === "warn") {
    nodeDetail = `Node ${nodeLabel} drifts from pinned ${pinned.node} (patch only)`;
  }
  checks.push({
    id: "setup-runtime-node",
    ok: nodeStatus !== "mismatch" && nodeStatus !== "missing",
    severity: "error",
    detail: nodeDetail,
    ...(nodeStatus === "ok" || nodeStatus === "warn"
      ? {}
      : {
          remediation: [`Install Node ${pinned.node} and re-run`],
        }),
  });
  if (checks.some((check) => !check.ok)) {
    return { checks, ok: false };
  }

  if (!isInstallStale(root)) {
    checks.push({
      id: "setup-dependencies",
      ok: true,
      severity: "error",
      detail: "node_modules is present and newer than bun.lock",
    });
    return { checks, ok: true };
  }
  if (checkOnly) {
    checks.push({
      id: "setup-dependencies",
      ok: true,
      severity: "error",
      detail: "node_modules is stale (would run bun ci)",
    });
    return { checks, ok: true };
  }
  const install = await runCommand(["bun", "ci"], {
    cwd: root,
    timeoutMs: 300_000,
  });
  if (install.exitCode !== 0) {
    return failed({
      id: "setup-dependencies",
      ok: false,
      severity: "error",
      detail: `bun ci failed: ${install.stderr.trim().split("\n").pop() || "unknown error"}`,
      remediation: ["Fix the install error above and re-run bun run setup"],
    });
  }
  try {
    markInstallFresh(root);
  } catch (error) {
    return failed({
      id: "setup-dependencies",
      ok: false,
      severity: "error",
      detail: `bun ci succeeded but the install could not be marked fresh: ${error instanceof Error ? error.message : String(error)}`,
      remediation: ["Check node_modules permissions and re-run bun run setup"],
    });
  }
  checks.push({
    id: "setup-dependencies",
    ok: true,
    severity: "error",
    detail: "dependencies installed with bun ci",
  });
  return { checks, ok: true };
};

export const runSetup = async (
  target: SupportedTarget,
  convex: ConvexMode,
  checkOnly: boolean,
  root: string = ROOT
): Promise<SetupReport> => {
  const worktree = await resolveWorktree(root);
  const base = { target, convex, profile: "local", worktree };
  let workos: "staging" | null = null;
  const fail = (checks: SetupCheck[]): SetupReport =>
    reportWith({
      ...base,
      workos,
      mode: checkOnly ? "check" : "run",
      checks,
    });

  const siteUrl = worktree.siteUrl;
  const webEnvPath =
    target === "web" ? join(root, "apps/web/.env.local") : undefined;

  let workosValues: Partial<Record<WorkosCredentialName, string>> = {};
  const prepared = await prepareCheckout(root, checkOnly);
  const checks = prepared.checks;
  if (!prepared.ok) {
    return fail(checks);
  }

  if (convex === "skip") {
    checks.push({
      id: "setup-convex-selection",
      ok: true,
      severity: "error",
      detail: `${target} needs no Convex deployment (convex: skip)`,
    });
  } else {
    workos = "staging";
    const cloud = await setupDevDeployment(root, checkOnly);
    checks.push(...cloud.checks);
    if (!cloud.ok) {
      return fail(checks);
    }
    workosValues = cloud.workos;
  }

  const plans = DERIVED_FILE_PLANS[target];
  if (plans.length === 0) {
    checks.push({
      id: "setup-derived-env",
      ok: true,
      severity: "error",
      detail: `${target} needs no derived dotenv file`,
    });
  } else if (checkOnly) {
    const rel = plans.map((plan) => plan.path.replace(`${root}/`, ""));
    checks.push({
      id: "setup-derived-env",
      ok: true,
      severity: "error",
      detail: `would derive ${rel.join(", ")} from the dev deployment without overwriting custom values`,
    });
  } else {
    const aliases = generateAliasValues({ ...DEV_DEPLOYMENT_URLS, siteUrl });
    const outcomes = plans.map((plan) => {
      const rel = plan.path.replace(`${root}/`, "");
      if (plan.path === webEnvPath) {
        return `${rel}: ${ensureWebEnv(plan.path, {
          ...DEV_DEPLOYMENT_URLS,
          siteUrl,
          workos: workosValues,
        })}`;
      }
      const entries = Object.fromEntries(
        plan.keys.map((key) => [key, aliases[key] ?? ""])
      );
      return `${rel}: ${ensureDerivedEnv(plan.path, entries)}`;
    });
    checks.push({
      id: "setup-derived-env",
      ok: true,
      severity: "error",
      detail: outcomes.join("; "),
    });
  }

  if (target === "mobile-device") {
    const lan = inferLanHost();
    checks.push({
      id: "setup-mobile-lan",
      ok: true,
      severity: "warn",
      detail: lan
        ? `simulator uses loopback; physical devices reach this host at ${lan}`
        : "no LAN address inferred; simulators work, physical devices need this host on a reachable network",
      ...(lan
        ? {}
        : {
            remediation: [
              "Join a LAN and re-run, or use --target mobile-simulator",
            ],
          }),
    });
  }
  if (target === "files-worker") {
    checks.push({
      id: "setup-files-pointer",
      ok: true,
      severity: "warn",
      detail: "worker secrets are owned by sync:cloudflare-dev, not setup",
      remediation: ["Run bun run sync:cloudflare-dev after setup"],
    });
  }

  const report = fail(checks);
  if (checkOnly) {
    report.capabilities = await planCapabilities({
      checkNetwork: true,
      convex,
      root,
      target,
      worktree,
    });
  }
  return report;
};

const printHuman = (report: SetupReport, checkOnly: boolean): void => {
  console.log(
    `\nTeak setup (target: ${report.target}, convex: ${report.convex}, WorkOS: ${report.workos ?? "none"}, worktree: ${report.worktree?.namespace ?? "main"})`
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
  if (!report.ok) {
    console.log("setup failed: see failing checks above");
  } else if (checkOnly) {
    console.log("setup --check: ok");
  } else {
    console.log("setup: complete (re-run is a no-op)");
  }
};

const main = async (): Promise<void> => {
  let options: SetupOptions;
  try {
    options = parseSetupArgs(process.argv);
  } catch (error) {
    if (error instanceof Error && error.message === "help") {
      console.log(SETUP_USAGE);
      return;
    }
    throw error;
  }
  if (!isSupportedTarget(options.target)) {
    const report = reportWith({
      target: options.target,
      mode: options.check ? "check" : "run",
      checks: [
        {
          id: "setup-target",
          ok: false,
          severity: "error",
          detail: `Unknown --target "${options.target}"`,
          remediation: [SETUP_USAGE],
        },
      ],
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report, options.check);
    }
    process.exitCode = 1;
    return;
  }
  const convex = resolveSetupConvex(options.target, options.convex);
  const report = await runSetup(options.target, convex, options.check, ROOT);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report, options.check);
  }
  process.exitCode = report.ok ? 0 : 1;
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (process.argv.includes("--json")) {
      console.log(
        JSON.stringify(
          reportWith({
            mode: process.argv.includes("--check") ? "check" : "run",
            checks: [
              {
                id: "setup-failed",
                ok: false,
                severity: "error",
                detail: error instanceof Error ? error.message : String(error),
                remediation: ["Re-run with --json for the full report"],
              },
            ],
          }),
          null,
          2
        )
      );
    } else {
      console.error(
        `setup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    process.exitCode = 1;
  }
}
