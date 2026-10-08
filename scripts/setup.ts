#!/usr/bin/env bun
/**
 * Idempotent local bootstrap for agents and developers.
 *
 * 1. Check the Bun and Node versions pinned by package.json.
 * 2. Run `bun ci` when node_modules is stale.
 * 3. Refuse an implicitly selected production Convex deployment.
 * 4. Preserve an existing isolated development deployment or provision one.
 * 5. Configure the local SITE_URL default and the WorkOS client ID and API
 *    key (never overwrites a set value).
 * 6. Run `bunx convex dev --once` for push and code generation.
 * 7. Derive the target's ignored local Convex configuration from canonical
 *    facts without overwriting custom values.
 *
 * Requires WorkOS staging or development credentials (WORKOS_CLIENT_ID and
 * WORKOS_API_KEY) for any target that uses Convex, and no production, Apple,
 * Cloudflare, billing, or release credentials. Every step is check-then-act, so re-running setup changes
 * nothing once the tree is ready. `--check` reports without changing state;
 * `--json` emits a stable machine-readable report with capabilities.
 *
 * Usage: bun run setup [--target <target>] [--convex local|cloud|skip] [--check] [--json]
 */

import { join } from "node:path";
import {
  EMULATOR_DEPLOYMENT_VARS,
  EMULATOR_WEB_ENV,
  LOCAL_APP_ORIGIN,
} from "../packages/tests/src/emulator/config.ts";
import {
  type Capabilities,
  type ConvexSelection,
  checkRuntimeVersion,
  inferLanHost,
  isInstallStale,
  isPortOccupied,
  markInstallFresh,
  planCapabilities,
  readConvexSelection,
  readNodeVersion,
  readPinnedVersions,
} from "./capabilities.ts";
import { generateAliasValues } from "./env-aliases.ts";
import { readDotenvFile } from "./env-loader.ts";
import {
  type ConvexMode,
  getTargetSpec,
  isSupportedTarget,
  type SupportedTarget,
} from "./env-targets.ts";
import { runCommand } from "./proc.ts";
import {
  convexDevOnce,
  ensureDeploymentVar,
  readConvexDotenvUrls,
  readDeploymentVar,
  setDeploymentVar,
} from "./setup-convex.ts";
import {
  ensureDerivedEnv,
  ensureWebEnv,
  LOCAL_CONVEX_SITE_URL,
  LOCAL_CONVEX_URL,
} from "./setup-derived-env.ts";
import {
  ensureWorkosCredentials,
  WORKOS_CREDENTIAL_NAMES,
  type WorkosCredentialName,
} from "./setup-workos.ts";
import { resolveWorktree, type WorktreePorts } from "./worktree-env.ts";

const ROOT = join(import.meta.dir, "..");
const CONVEX_DIR = (root: string): string => join(root, "packages/convex");
const WEB_ENV_PATH = join(ROOT, "apps/web/.env.local");
const DESKTOP_ENV_PATH = join(ROOT, "apps/desktop/.env.local");
const EXTENSION_ENV_PATH = join(ROOT, "apps/extension/.env.local");
const MOBILE_ENV_PATH = join(ROOT, "apps/mobile/.env.local");

export const LOCAL_SITE_URL = "http://localhost:3000";

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

export const isProductionDeployment = (deployment?: string): boolean =>
  deployment?.startsWith("prod:") ?? false;

export const assertNoProductionConvex = (
  selection: ConvexSelection,
  deployKey?: string
): void => {
  if (deployKey?.trim()) {
    throw new Error(
      "Refusing setup with CONVEX_DEPLOY_KEY set: the key implicitly selects " +
        "the production deployment. Unset CONVEX_DEPLOY_KEY (setup never uses " +
        "production credentials) and re-run bun run setup."
    );
  }
  if (isProductionDeployment(selection.deployment)) {
    throw new Error(
      `Refusing setup against the production Convex deployment (${selection.deployment}). ` +
        "Point CONVEX_DEPLOYMENT at an isolated development deployment or " +
        "unset it so setup can provision one."
    );
  }
};

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
  worktree: WorktreePorts | null;
}

export const SETUP_USAGE =
  "Usage: bun run setup [--target web|docs|cli|desktop|extension|mobile-simulator|mobile-device|files-worker|e2e] [--convex local|cloud|skip] [--check] [--json]";

const CONVEX_MODES: readonly string[] = ["local", "cloud", "skip"];

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
          `Unknown --convex "${value ?? ""}" (expected local, cloud, skip)`
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
  desktop: [
    {
      path: DESKTOP_ENV_PATH,
      keys: [
        "VITE_PUBLIC_CONVEX_URL",
        "VITE_PUBLIC_CONVEX_SITE_URL",
        "VITE_WEB_URL",
      ],
    },
  ],
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
  e2e: [WEB_PLAN],
};

// The e2e stack's deployment also receives the emulator's signed webhooks.
// Setup never overwrites a set value, so a different one is a conflict.
const ensureEmulatorWebhookVars = async (
  convexDir: string
): Promise<SetupCheck> => {
  const configured: string[] = [];
  for (const name of [
    "WORKOS_ENVIRONMENT_ID",
    "WORKOS_WEBHOOK_SECRET",
  ] as const) {
    const expected = EMULATOR_DEPLOYMENT_VARS[name];
    const current = await readDeploymentVar(name, convexDir);
    if (current.status === "unavailable") {
      return {
        id: "setup-e2e-emulator",
        ok: false,
        severity: "error",
        detail: `could not read ${name} from the selected deployment: ${current.detail}`,
        remediation: [
          "Export CONVEX_AGENT_MODE=anonymous and re-run bun run setup --target e2e",
        ],
      };
    }
    if (current.status === "found" && current.value !== expected) {
      return {
        id: "setup-e2e-emulator",
        ok: false,
        severity: "error",
        detail: `${name} on the deployment is not the WorkOS emulator's value`,
        remediation: [
          `Run \`bunx convex env remove ${name}\` in packages/convex (this deployment is for the e2e stack), then re-run`,
        ],
      };
    }
    if (current.status === "missing") {
      try {
        await setDeploymentVar(name, expected, convexDir);
      } catch (error) {
        return {
          id: "setup-e2e-emulator",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : String(error),
          remediation: [
            "Export CONVEX_AGENT_MODE=anonymous and re-run bun run setup --target e2e",
          ],
        };
      }
      configured.push(name);
    }
  }
  return {
    id: "setup-e2e-emulator",
    ok: true,
    severity: "error",
    detail:
      configured.length > 0
        ? `configured ${configured.join(", ")} for the WorkOS emulator`
        : "WorkOS emulator webhook settings already set",
  };
};

const reportWith = (
  partial: Partial<SetupReport> & { checks: SetupCheck[] }
): SetupReport => ({
  version: SETUP_VERSION,
  target: "web",
  convex: "local",
  profile: "local",
  mode: "run",
  worktree: null,
  ...partial,
  ok: !partial.checks.some((check) => !check.ok && check.severity === "error"),
});

export const runSetup = async (
  target: SupportedTarget,
  convex: ConvexMode,
  checkOnly: boolean,
  root: string = ROOT
): Promise<SetupReport> => {
  const worktree = await resolveWorktree(root);
  const profile = target === "e2e" ? "e2e" : "local";
  const base = { target, convex, profile, worktree };
  const fail = (checks: SetupCheck[]): SetupReport =>
    reportWith({
      ...base,
      mode: checkOnly ? "check" : "run",
      checks,
    });

  const e2e = target === "e2e";
  if (e2e && convex !== "local") {
    return fail([
      {
        id: "setup-e2e-convex",
        ok: false,
        severity: "error",
        detail:
          "the e2e stack runs against the WorkOS emulator, which only a local backend can reach",
        remediation: ["Run bun run setup --target e2e --convex local"],
      },
    ]);
  }
  // The e2e stack always serves the web app on the fixed local origin, which
  // the emulator's redirect and the suite's URLs expect.
  const siteUrl = e2e ? LOCAL_APP_ORIGIN : worktree.siteUrl;
  const webEnvPath =
    target === "web" || e2e ? join(root, "apps/web/.env.local") : undefined;

  const checks: SetupCheck[] = [];
  // Without a deployment step (--convex skip), only explicit exports apply.
  let workosValues: Partial<Record<WorkosCredentialName, string>> =
    Object.fromEntries(
      WORKOS_CREDENTIAL_NAMES.flatMap((name) => {
        const value = process.env[name]?.trim();
        return value ? [[name, value]] : [];
      })
    );
  let pinned: { bun: string; node: string };
  try {
    pinned = readPinnedVersions(root);
  } catch (error) {
    return fail([
      {
        id: "setup-runtime-pins",
        ok: false,
        severity: "error",
        detail: error instanceof Error ? error.message : String(error),
        remediation: [
          "Restore packageManager and engines.node in package.json",
        ],
      },
    ]);
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
    return fail(checks);
  }

  if (isInstallStale(root)) {
    if (checkOnly) {
      checks.push({
        id: "setup-dependencies",
        ok: true,
        severity: "error",
        detail: "node_modules is stale (would run bun ci)",
      });
    } else {
      const install = await runCommand(["bun", "ci"], {
        cwd: root,
        timeoutMs: 300_000,
      });
      if (install.exitCode !== 0) {
        return fail([
          ...checks,
          {
            id: "setup-dependencies",
            ok: false,
            severity: "error",
            detail: `bun ci failed: ${install.stderr.trim().split("\n").pop() || "unknown error"}`,
            remediation: [
              "Fix the install error above and re-run bun run setup",
            ],
          },
        ]);
      }
      try {
        markInstallFresh(root);
      } catch (error) {
        return fail([
          ...checks,
          {
            id: "setup-dependencies",
            ok: false,
            severity: "error",
            detail: `bun ci succeeded but the install could not be marked fresh: ${error instanceof Error ? error.message : String(error)}`,
            remediation: [
              "Check node_modules permissions and re-run bun run setup",
            ],
          },
        ]);
      }
      checks.push({
        id: "setup-dependencies",
        ok: true,
        severity: "error",
        detail: "dependencies installed with bun ci",
      });
    }
  } else {
    checks.push({
      id: "setup-dependencies",
      ok: true,
      severity: "error",
      detail: "node_modules is present and newer than bun.lock",
    });
  }

  if (convex === "skip") {
    checks.push({
      id: "setup-convex-selection",
      ok: true,
      severity: "error",
      detail: `${target} needs no Convex deployment (convex: skip)`,
    });
  } else {
    const selection = readConvexSelection(
      process.env,
      join(root, "packages/convex/.env.local")
    );
    try {
      assertNoProductionConvex(selection, process.env.CONVEX_DEPLOY_KEY);
    } catch (error) {
      return fail([
        ...checks,
        {
          id: "setup-convex-selection",
          ok: false,
          severity: "error",
          detail: error instanceof Error ? error.message : String(error),
          remediation: [
            "Unset CONVEX_DEPLOY_KEY and point CONVEX_DEPLOYMENT at an isolated development deployment",
          ],
        },
      ]);
    }
    checks.push({
      id: "setup-convex-selection",
      ok: true,
      severity: "error",
      detail: selection.deployment
        ? `preserving ${selection.deployment} (from ${selection.source})`
        : "none selected (convex dev will provision an isolated development deployment)",
    });

    // Local Convex backends bind fixed ports, so a namespaced checkout that
    // selects local collides with the main stack. Cloud deployments do not.
    if (worktree.namespaced && convex === "local") {
      const occupied: number[] = [];
      for (const port of [worktree.convex, worktree.convexSite]) {
        if (await isPortOccupied(port)) {
          occupied.push(port);
        }
      }
      if (occupied.length > 0) {
        return fail([
          ...checks,
          {
            id: "setup-convex-ports",
            ok: false,
            severity: "error",
            detail: `local Convex ports in use: ${occupied.join(", ")} (fixed ports collide across checkouts)`,
            remediation: [
              "Stop the main checkout stack, or use --convex cloud for an isolated cloud development deployment",
            ],
          },
        ]);
      }
    }

    // Provision first when nothing is selected: the first push may fail on
    // the missing SITE_URL, which the next step configures before the final
    // push. Best-effort here; the final push below must succeed.
    if (!(selection.deployment || checkOnly)) {
      const provision = await convexDevOnce(CONVEX_DIR(root));
      checks.push({
        id: "setup-convex-provision",
        ok: true,
        severity: "error",
        detail: provision.ok
          ? `provisioned (${provision.detail})`
          : `deferred (${provision.detail})`,
      });
    }

    if (checkOnly) {
      checks.push({
        id: "setup-convex-deploy-vars",
        ok: true,
        severity: "error",
        detail:
          "would verify SITE_URL, WORKOS_CLIENT_ID and WORKOS_API_KEY with `convex env get` and set them when missing",
      });
      checks.push({
        id: "setup-convex-push",
        ok: true,
        severity: "error",
        detail: "would run `bunx convex dev --once` in packages/convex",
      });
    } else {
      try {
        const convexDir = CONVEX_DIR(root);
        const site = await ensureDeploymentVar("SITE_URL", siteUrl, convexDir);
        checks.push({
          id: "setup-convex-deploy-vars",
          ok: true,
          severity: "error",
          detail: `SITE_URL ${site}`,
        });
      } catch (error) {
        return fail([
          ...checks,
          {
            id: "setup-convex-deploy-vars",
            ok: false,
            severity: "error",
            detail: error instanceof Error ? error.message : String(error),
            remediation: [
              "Run `bunx convex login` (or export CONVEX_AGENT_MODE=anonymous) and re-run",
            ],
          },
        ]);
      }
      // auth.config.ts reads WORKOS_CLIENT_ID, so it must be set before the push.
      const workos = await ensureWorkosCredentials(
        CONVEX_DIR(root),
        webEnvPath,
        convex === "local",
        e2e ? EMULATOR_DEPLOYMENT_VARS : process.env
      );
      checks.push(workos.check);
      if (!workos.check.ok) {
        return fail(checks);
      }
      if (e2e) {
        const webhook = await ensureEmulatorWebhookVars(CONVEX_DIR(root));
        checks.push(webhook);
        if (!webhook.ok) {
          return fail(checks);
        }
      }
      workosValues = workos.values;
      const push = await convexDevOnce(CONVEX_DIR(root));
      if (!push.ok) {
        return fail([
          ...checks,
          {
            id: "setup-convex-push",
            ok: false,
            severity: "error",
            detail: `convex dev --once failed: ${push.detail}`,
            remediation: ["Fix the push error above and re-run bun run setup"],
          },
        ]);
      }
      checks.push({
        id: "setup-convex-push",
        ok: true,
        severity: "error",
        detail: "code pushed and types generated",
      });
    }
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
      detail: `would derive ${rel.join(", ")} from the active Convex deployment without overwriting custom values`,
    });
  } else {
    // Setup keeps custom web values, so an e2e web env must not already point
    // authkit-nextjs at a WorkOS host other than the emulator.
    const webValues =
      e2e && webEnvPath ? readDotenvFile(webEnvPath)?.values : undefined;
    const conflicting = Object.entries(EMULATOR_WEB_ENV).flatMap(
      ([name, value]) =>
        webValues?.has(name) && webValues.get(name) !== value ? [name] : []
    );
    if (conflicting.length > 0) {
      return fail([
        ...checks,
        {
          id: "setup-e2e-emulator",
          ok: false,
          severity: "error",
          detail: `apps/web/.env.local sets ${conflicting.join(", ")} to a WorkOS host other than the emulator`,
          remediation: [
            `Remove ${conflicting.join(", ")} from apps/web/.env.local and re-run bun run setup --target e2e`,
          ],
        },
      ]);
    }
    const derived = readConvexDotenvUrls(
      join(root, "packages/convex/.env.local")
    );
    const aliases = generateAliasValues({
      convexUrl: derived.convexUrl ?? LOCAL_CONVEX_URL,
      convexSiteUrl: derived.convexSiteUrl ?? LOCAL_CONVEX_SITE_URL,
      siteUrl,
    });
    const outcomes = plans.map((plan) => {
      if (plan.path === webEnvPath) {
        const result = ensureWebEnv(plan.path, {
          convexUrl: derived.convexUrl ?? LOCAL_CONVEX_URL,
          convexSiteUrl: derived.convexSiteUrl ?? LOCAL_CONVEX_SITE_URL,
          siteUrl,
          workos: workosValues,
          ...(e2e ? { extra: EMULATOR_WEB_ENV } : {}),
        });
        return `${plan.path.replace(`${root}/`, "")}: ${result}`;
      }
      const entries = Object.fromEntries(
        plan.keys.map((key) => [key, aliases[key] ?? ""])
      );
      const rel = plan.path.replace(`${root}/`, "");
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
    `\nTeak setup (target: ${report.target}, convex: ${report.convex}, worktree: ${report.worktree?.namespace ?? "main"})`
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
  const report = await runSetup(options.target, convex, options.check);
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
