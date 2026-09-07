#!/usr/bin/env bun
/**
 * Read-only Cloudflare / R2 configuration parity check.
 * Reports names and parity status without exposing secret values.
 *
 * Checks:
 * - Wrangler top-level bindings (R2, Images, AI) and removal of development env
 * - Local .dev.vars presence (ignored, per-surface; never blocks)
 * - Expected Convex env names and their parity if deployments are reachable
 *
 * Exit code is 1 when a blocking finding exists (missing or mismatched
 * repository or deployment configuration). Warnings for unreachable
 * deployments and the per-developer .dev.vars file never block.
 *
 * A production CONVEX_DEPLOY_KEY is scoped to the production deployment, so
 * CI scopes the check with --only prod and gates on what the key can verify.
 *
 * Usage: bun run check:cloudflare [--only prod|dev]
 *        bun run scripts/check-cloudflare.ts [--only prod|dev]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CONVEX_PATH = join(ROOT, "packages/convex");
const WRANGLER_PATH = join(ROOT, "apps/files-worker/wrangler.jsonc");
const DEV_VARS_PATH = join(ROOT, "apps/files-worker/.dev.vars");

type Status = "same" | "different" | "missing" | "ok" | "warn";

let failureCount = 0;

export const isBlockingFinding = (
  status: Status,
  opts?: { blocking?: boolean }
): boolean =>
  opts?.blocking ?? (status === "missing" || status === "different");

export type DeploymentValueResult =
  | { status: "found"; value: string }
  | { status: "missing" }
  | { status: "skipped" }
  | { status: "unavailable"; reason: "command_failed" | "spawn_failed" };

export type DeploymentScope = "prod" | "dev";

export const parseScopeArg = (argv: string[]): DeploymentScope | null => {
  const index = argv.indexOf("--only");
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (value !== "prod" && value !== "dev") {
    throw new Error("Usage: bun run check:cloudflare [--only prod|dev]");
  }
  return value;
};

export const parseConvexEnvOutput = (
  stdout: string,
  stderr: string,
  exitCode: number
): DeploymentValueResult => {
  const combined = `${stdout}\n${stderr}`;
  if (/environment variable .* not found/i.test(combined)) {
    return { status: "missing" };
  }
  if (exitCode !== 0) {
    return { status: "unavailable", reason: "command_failed" };
  }
  const value = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !(line.includes("ExperimentalWarning") || line.includes("Use node"))
    )
    .at(-1);
  return value
    ? { status: "found", value }
    : { status: "unavailable", reason: "command_failed" };
};

const expectedProdVars = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "FILES_SIGNING_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ENDPOINT",
  "R2_SECRET_ACCESS_KEY",
  "R2_TOKEN",
] as const;

const expectedDevVars = [
  ...expectedProdVars,
  "R2_BUCKET",
  "R2_KEY_PREFIX",
  "FILES_BASE",
  "FILES_LEGACY_BASE",
] as const;

const log = (
  label: string,
  status: Status,
  detail?: string,
  opts?: { blocking?: boolean }
) => {
  let icon: string;
  if (status === "same" || status === "ok") {
    icon = "✓";
  } else if (status === "missing") {
    icon = "✗";
  } else {
    icon = "•";
  }
  console.log(`${icon} ${label}: ${status}${detail ? ` (${detail})` : ""}`);
  if (isBlockingFinding(status, opts)) {
    failureCount += 1;
  }
};

const checkWrangler = () => {
  console.log("\n== Wrangler (apps/files-worker/wrangler.jsonc) ==");
  if (!existsSync(WRANGLER_PATH)) {
    log("wrangler.jsonc", "missing");
    return;
  }
  try {
    const raw = readFileSync(WRANGLER_PATH, "utf-8");
    // wrangler.jsonc may contain comments; strip // and /* */
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(stripped);
    const hasEnvDev = Boolean(cfg.env?.development);
    log(
      "top-level bucket",
      cfg.r2_buckets?.[0]?.bucket_name ? "ok" : "missing",
      cfg.r2_buckets?.[0]?.bucket_name ?? "no bucket"
    );
    log(
      "top-level binding BUCKET",
      cfg.r2_buckets?.[0]?.binding === "BUCKET" ? "ok" : "missing"
    );
    log("Images binding", cfg.images?.binding === "IMAGES" ? "ok" : "missing");
    log("AI binding", cfg.ai?.binding === "AI" ? "ok" : "missing");
    log(
      "development env removed",
      hasEnvDev ? "warn" : "ok",
      hasEnvDev ? "env.development still present" : "canonical config prod-only"
    );
    if (hasEnvDev) {
      console.log(
        "  Note: live files-dev Worker/domain/teak-files-dev bucket are retained for rollback but not in wrangler.jsonc."
      );
    }
    log(
      "remote bindings",
      "ok",
      "R2 and Images support --remote while Worker code stays local"
    );
  } catch (err) {
    log("wrangler.jsonc parse", "warn", String(err), { blocking: true });
  }
};

const checkDevVars = () => {
  console.log("\n== Local .dev.vars (apps/files-worker/.dev.vars) ==");
  if (existsSync(DEV_VARS_PATH)) {
    log(".dev.vars", "ok", "present (ignored via .gitignore, per-developer)");
    try {
      const content = readFileSync(DEV_VARS_PATH, "utf-8");
      const hasSecret = content.includes("FILES_SIGNING_SECRET");
      log(
        "FILES_SIGNING_SECRET in .dev.vars",
        hasSecret ? "ok" : "missing",
        "must match Convex FILES_SIGNING_SECRET",
        { blocking: false }
      );
      if (
        content.includes("R2_BUCKET") ||
        content.includes("R2_KEY_PREFIX") ||
        content.includes("FILES_BASE")
      ) {
        log(
          ".dev.vars routing vars",
          "warn",
          "R2_BUCKET/R2_KEY_PREFIX/FILES_BASE belong in Convex env, not .dev.vars"
        );
      }
    } catch {}
  } else {
    log(".dev.vars", "missing", "run bun run sync:cloudflare-dev", {
      blocking: false,
    });
  }
  console.log(
    "  Production-data warning: dev bucket is prod (teak-files-prod + dev/ prefix). Writes are isolated by prefix but share credentials bucket-wide."
  );
};

const checkConvexEnv = async (only: DeploymentScope | null) => {
  console.log("\n== Convex env parity (read-only, no secret output) ==");
  if (only) {
    console.log(`  Scope: --only ${only} (other deployment skipped)`);
  }
  console.log(`  Expected prod vars: ${expectedProdVars.join(", ")}`);
  console.log(`  Expected dev vars: ${expectedDevVars.join(", ")}`);
  console.log(
    "  Dev-specific routing: R2_BUCKET=teak-files-prod, R2_KEY_PREFIX=dev/, FILES_BASE=https://files.teakvault.com, FILES_LEGACY_BASE=https://files-dev.teakvault.com"
  );

  const getDeploymentValue = async (
    name: string,
    deployment: "prod" | "dev"
  ): Promise<DeploymentValueResult> => {
    if (only && deployment !== only) {
      return { status: "skipped" };
    }
    try {
      const proc = Bun.spawn(
        ["bunx", "convex", "env", "get", name, "--deployment", deployment],
        { cwd: CONVEX_PATH, stdout: "pipe", stderr: "pipe" }
      );
      await proc.exited;
      const out = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      return parseConvexEnvOutput(out, err, proc.exitCode ?? 1);
    } catch {
      return { status: "unavailable", reason: "spawn_failed" };
    }
  };

  const routingVars = [
    "R2_BUCKET",
    "R2_KEY_PREFIX",
    "FILES_BASE",
    "FILES_LEGACY_BASE",
  ] as const;
  const deploymentValues = new Map(
    await Promise.all(
      [...expectedProdVars, ...routingVars].map(async (name) => {
        const [prod, dev] = await Promise.all([
          getDeploymentValue(name, "prod"),
          getDeploymentValue(name, "dev"),
        ]);
        return [name, { dev, prod }] as const;
      })
    )
  );

  for (const name of expectedProdVars) {
    const values = deploymentValues.get(name);
    if (!values) {
      log(name, "warn", "parity result unavailable");
      continue;
    }
    const { dev, prod } = values;
    if (prod.status === "skipped" || dev.status === "skipped") {
      const side = prod.status === "skipped" ? dev : prod;
      const sideName = prod.status === "skipped" ? "dev" : "prod";
      if (side.status === "unavailable") {
        log(name, "warn", `Convex ${sideName} deployment unavailable`);
      } else if (side.status === "missing") {
        log(name, "missing", `${sideName} missing`);
      } else if (side.status === "found") {
        log(name, "ok", `present in ${sideName}`);
      }
      continue;
    }
    if (prod.status === "unavailable" || dev.status === "unavailable") {
      log(name, "warn", "Convex CLI or deployment unavailable");
    } else if (prod.status === "missing" && dev.status === "missing") {
      log(name, "missing", "both deployments missing");
    } else if (prod.status === "missing") {
      log(name, "missing", "prod missing");
    } else if (dev.status === "missing") {
      log(name, "missing", "dev missing");
    } else if (prod.value === dev.value) {
      log(name, "same", "prod == dev");
    } else {
      log(name, "different", "prod != dev (content not shown)");
    }
  }
  for (const name of routingVars) {
    const values = deploymentValues.get(name);
    if (!values) {
      log(name, "warn", "parity result unavailable");
      continue;
    }
    const { dev, prod } = values;
    if (dev.status === "unavailable" || prod.status === "unavailable") {
      log(name, "warn", "Convex CLI or deployment unavailable");
      continue;
    }
    if (name === "R2_KEY_PREFIX") {
      if (dev.status !== "skipped") {
        if (dev.status === "missing") {
          log(name, "missing", "dev should be dev/");
        } else if (dev.value === "dev/") {
          log(name, "same", "dev prefix ok");
        } else {
          log(name, "different", "dev prefix is set incorrectly");
        }
      }
      if (prod.status !== "skipped") {
        if (prod.status === "found") {
          log(`${name} (prod)`, "different", "prod should be unset");
        } else {
          log(`${name} (prod)`, "same", "prod prefix unset");
        }
      }
      continue;
    }
    if (name === "FILES_LEGACY_BASE") {
      if (dev.status !== "skipped") {
        if (
          dev.status === "found" &&
          dev.value === "https://files-dev.teakvault.com"
        ) {
          log(name, "same", "legacy dev reads retained");
        } else {
          log(name, "missing", "dev legacy reads require the retained worker");
        }
      }
      if (prod.status !== "skipped") {
        if (prod.status === "found") {
          log(`${name} (prod)`, "different", "prod should be unset");
        } else {
          log(`${name} (prod)`, "same", "prod legacy route unset");
        }
      }
      continue;
    }
    const expected =
      name === "R2_BUCKET" ? "teak-files-prod" : "https://files.teakvault.com";
    const sides = [
      { result: dev, sideName: "dev" },
      { result: prod, sideName: "prod" },
    ].filter(({ result }) => result.status !== "skipped");
    const scopeNote = only ? ` (--only ${only})` : "";
    if (sides.some(({ result }) => result.status === "missing")) {
      log(name, "missing", `required${scopeNote}`);
    } else if (
      sides.every(
        ({ result }) => result.status === "found" && result.value === expected
      )
    ) {
      log(name, "same", `canonical value${scopeNote}`);
    } else {
      log(name, "different", `differs from the canonical value${scopeNote}`);
    }
  }

  console.log(
    "\n  Convergence: read prod values (CLOUDFLARE_* etc.) and set in Convex dev via `bunx convex env set --deployment dev NAME` without logging; report only same/different/missing."
  );
  console.log(
    "  Prefix is routine-mistake protection, not a hard security boundary; shared credentials retain bucket-wide authority."
  );
};

const main = async () => {
  console.log(
    "Cloudflare / R2 parity check (read-only, secrets never printed)"
  );
  const only = parseScopeArg(process.argv.slice(2));
  checkWrangler();
  checkDevVars();
  await checkConvexEnv(only);
  console.log("\n== Summary ==");
  console.log(
    "  • Keep `bun run dev:all` for all-surface stack; use `bun run dev:files` (remote bindings) vs `bun run dev:files:local` (Miniflare, low-fidelity Images)."
  );
  console.log(
    "  • One-time Convex convergence required; .dev.vars is ignored and per-developer; prod-data warning applies (shared bucket + prefix)."
  );
  console.log(
    "  • Rollback: wrangler.jsonc env.development removed but live files-dev Worker/domain/teak-files-dev bucket retained; re-add env block to rollback or set Convex dev FILES_BASE/R2_BUCKET back to files-dev."
  );
  if (failureCount > 0) {
    console.log(
      `\ncheck:cloudflare found ${failureCount} blocking finding${failureCount === 1 ? "" : "s"} (exit 1).`
    );
    process.exitCode = 1;
  } else {
    console.log("\ncheck:cloudflare found no blocking findings.");
  }
  console.log("");
};

if (import.meta.main) {
  await main();
}
