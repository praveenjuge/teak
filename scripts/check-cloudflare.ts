#!/usr/bin/env bun
/**
 * Read-only Cloudflare / R2 configuration parity check.
 * Reports names and parity status without exposing secret values.
 *
 * Checks:
 * - Wrangler top-level bindings (R2, Images, AI) and removal of development env
 * - Local .dev.vars presence (ignored, per-surface)
 * - Expected Convex env names and their parity if deployments are reachable
 *
 * Usage: bun run check:cloudflare
 *        bun run scripts/check-cloudflare.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WRANGLER_PATH = join(ROOT, "apps/files-worker/wrangler.jsonc");
const DEV_VARS_PATH = join(ROOT, "apps/files-worker/.dev.vars");

type Status = "same" | "different" | "missing" | "updated" | "ok" | "warn";

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
] as const;

const log = (label: string, status: Status, detail?: string) => {
  let icon: string;
  if (status === "same" || status === "ok") {
    icon = "✓";
  } else if (status === "missing") {
    icon = "✗";
  } else {
    icon = "•";
  }
  console.log(`${icon} ${label}: ${status}${detail ? ` (${detail})` : ""}`);
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
    log("wrangler.jsonc parse", "warn", String(err));
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
        "must match Convex FILES_SIGNING_SECRET"
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
    log(
      ".dev.vars",
      "missing",
      "create from template: echo 'FILES_SIGNING_SECRET=...' > apps/files-worker/.dev.vars (ignored)"
    );
  }
  console.log(
    "  Production-data warning: dev bucket is prod (teak-files-prod + dev/ prefix). Writes are isolated by prefix but share credentials bucket-wide."
  );
};

const checkConvexEnv = async () => {
  console.log("\n== Convex env parity (read-only, no secret output) ==");
  console.log(`  Expected prod vars: ${expectedProdVars.join(", ")}`);
  console.log(`  Expected dev vars: ${expectedDevVars.join(", ")}`);
  console.log(
    "  Dev-specific routing: R2_BUCKET=teak-files-prod, R2_KEY_PREFIX=dev/, FILES_BASE=https://files.teakvault.com (or temp preview during pre-merge)"
  );

  const getDeploymentValue = async (
    name: string,
    deployment: "prod" | "dev"
  ): Promise<{ found: boolean; value: string }> => {
    try {
      // biome-ignore lint/correctness/noUndeclaredVariables: Bun global in Bun runtime
      const proc = Bun.spawn(
        ["npx", "convex", "env", "get", name, "--deployment", deployment],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
      );
      await proc.exited;
      const out = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      const combined = `${out}\n${err}`;
      if (combined.includes("not found")) {
        return { found: false, value: "" };
      }
      const lines = out
        .split("\n")
        .filter(
          (l) => !(l.includes("ExperimentalWarning") || l.includes("Use node"))
        );
      const value = lines[lines.length - 1]?.trim() ?? "";
      if (!value || proc.exitCode !== 0) {
        return { found: false, value: "" };
      }
      return { found: true, value };
    } catch {
      return { found: false, value: "" };
    }
  };

  let hasDeployment = false;
  try {
    const test = await getDeploymentValue("CLOUDFLARE_ACCOUNT_ID", "prod");
    hasDeployment =
      test.found ||
      (await getDeploymentValue("CLOUDFLARE_ACCOUNT_ID", "dev")).found;
  } catch {}

  if (hasDeployment) {
    for (const name of expectedProdVars) {
      const prod = await getDeploymentValue(name, "prod");
      const dev = await getDeploymentValue(name, "dev");
      if (!(prod.found || dev.found)) {
        log(name, "missing", "both deployments missing");
      } else if (!prod.found) {
        log(name, "missing", "prod missing");
      } else if (!dev.found) {
        log(name, "missing", "dev missing");
      } else if (prod.value === dev.value) {
        log(name, "same", "prod == dev");
      } else {
        log(name, "different", "prod != dev (content not shown)");
      }
    }
    for (const name of ["R2_BUCKET", "R2_KEY_PREFIX", "FILES_BASE"] as const) {
      const dev = await getDeploymentValue(name, "dev");
      const prod = await getDeploymentValue(name, "prod");
      if (name === "R2_KEY_PREFIX") {
        if (!dev.found) {
          log(name, "missing", "dev should be dev/");
        } else if (dev.value === "dev/") {
          log(name, "same", "dev prefix ok");
        } else {
          log(
            name,
            "different",
            `dev is ${dev.value ? "set" : "missing"} (content not shown)`
          );
        }
        if (prod.found) {
          log(`${name} (prod)`, "different", "prod should be unset");
        }
        continue;
      }
      if (
        name === "R2_BUCKET" &&
        dev.found &&
        dev.value === "teak-files-prod"
      ) {
        log(name, "same", "prod bucket canonical");
      } else if (
        name === "FILES_BASE" &&
        dev.found &&
        dev.value === "https://files.teakvault.com"
      ) {
        log(name, "same", "worker origin prod");
      } else if (dev.found) {
        log(name, "different", "value present (content not shown)");
      } else {
        log(name, "missing");
      }
    }
  } else {
    console.log(
      "  (No Convex deployment reachable locally; reporting local env presence only)"
    );
    for (const name of expectedProdVars) {
      const present = Boolean(process.env[name]);
      log(
        `prod ${name}`,
        present ? "ok" : "missing",
        present
          ? "set locally or via Convex"
          : "copy from Convex prod to dev without logging value"
      );
    }
    for (const name of ["R2_BUCKET", "R2_KEY_PREFIX", "FILES_BASE"] as const) {
      const val = process.env[name];
      if (!val) {
        log(`dev ${name}`, "missing");
      } else if (name === "R2_BUCKET" && val === "teak-files-prod") {
        log(`dev ${name}`, "ok", "prod bucket canonical");
      } else if (name === "R2_KEY_PREFIX" && val === "dev/") {
        log(`dev ${name}`, "ok", "dev prefix");
      } else if (name === "FILES_BASE" && val.startsWith("https://")) {
        log(`dev ${name}`, "ok", "worker origin");
      } else {
        log(`dev ${name}`, "different", "value present (content not shown)");
      }
    }
  }

  console.log(
    "\n  Convergence: read prod values (CLOUDFLARE_* etc.) and set in Convex dev via `npx convex env set --deployment dev NAME` without logging; report only same/different/missing/updated."
  );
  console.log(
    "  Prefix is routine-mistake protection, not a hard security boundary; shared credentials retain bucket-wide authority."
  );
};

const main = async () => {
  console.log(
    "Cloudflare / R2 parity check (read-only, secrets never printed)"
  );
  checkWrangler();
  checkDevVars();
  await checkConvexEnv();
  console.log("\n== Summary ==");
  console.log(
    "  • Keep `bun run dev` for all-surface stack; use `bun run dev:files` (remote bindings) vs `bun run dev:files:local` (Miniflare, low-fidelity Images)."
  );
  console.log(
    "  • One-time Convex convergence required; .dev.vars is ignored and per-developer; prod-data warning applies (shared bucket + prefix)."
  );
  console.log(
    "  • Rollback: wrangler.jsonc env.development removed but live files-dev Worker/domain/teak-files-dev bucket retained; re-add env block to rollback or set Convex dev FILES_BASE/R2_BUCKET back to files-dev."
  );
  console.log("");
};

await main();
