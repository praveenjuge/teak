#!/usr/bin/env bun
/**
 * Read-only Cloudflare / R2 configuration parity check.
 * Reports names and parity status without exposing secret values.
 *
 * Checks:
 * - Wrangler top-level bindings (R2, Images, AI) and removal of development env
 * - Local .dev.vars presence (ignored, per-surface; never blocks)
 * - Expected Convex env names and their parity if deployments are reachable
 * - Development storage state: the current shared production Worker/bucket
 *   (prefix-only separation) or the isolated development target. Credential
 *   parity follows that state; a mix of both blocks.
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
const ISOLATED_DEV_VARS_PATH = join(
  ROOT,
  "apps/files-worker/development/.dev.vars"
);

export type Status = "same" | "different" | "missing" | "ok" | "warn";

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

export const PRODUCTION_STORAGE_BUCKET = "teak-files-prod";
export const PRODUCTION_FILES_BASE = "https://files.teakvault.com";
export const DEVELOPMENT_STORAGE_BUCKET = "teak-files-development-20261006";
export const DEVELOPMENT_KEY_PREFIX = "dev/";

/**
 * workers.dev origin of the dedicated `teak-files-development` Worker on the
 * Teak account's `praveenjuge` subdomain. Web and shared UI trust
 * exactly this origin for the dev deployment; keep them in step.
 */
export const DEVELOPMENT_FILES_ORIGIN =
  "https://teak-files-development.praveenjuge.workers.dev";

export const isDevelopmentFilesOrigin = (value: string | undefined): boolean =>
  value === DEVELOPMENT_FILES_ORIGIN;

/**
 * `shared`: the current state. Development uses the production Worker and
 * bucket, separated only by the `dev/` key prefix and sharing credentials.
 * `isolated`: the target. Development uses its own Worker and bucket.
 * Anything else, including a partial switch, is `invalid`.
 */
export type DevStorageState = "shared" | "isolated" | "invalid";

export const classifyDevStorage = (routing: {
  bucket: string | undefined;
  prefix: string | undefined;
  filesBase: string | undefined;
}): DevStorageState => {
  if (routing.prefix !== DEVELOPMENT_KEY_PREFIX) {
    return "invalid";
  }
  if (
    routing.bucket === PRODUCTION_STORAGE_BUCKET &&
    routing.filesBase === PRODUCTION_FILES_BASE
  ) {
    return "shared";
  }
  if (
    routing.bucket === DEVELOPMENT_STORAGE_BUCKET &&
    isDevelopmentFilesOrigin(routing.filesBase)
  ) {
    return "isolated";
  }
  return "invalid";
};

const STORAGE_CREDENTIALS = new Set([
  "FILES_SIGNING_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
]);

export interface Finding {
  blocking?: boolean;
  detail: string;
  status: Status;
}

/**
 * Shared storage needs the production signing key and S3 credentials; isolated
 * storage must never reuse them. Account, endpoint and AI token stay identical.
 * Unknown dev routing (skipped/unavailable) keeps the shared expectations.
 */
export const credentialParityFinding = (
  name: string,
  devState: DevStorageState | null,
  same: boolean
): Finding => {
  if (devState === "invalid") {
    // The dev storage routing finding already blocks.
    return {
      status: "warn",
      detail: "not compared while dev storage routing is invalid",
    };
  }
  const expectSame = !(
    devState === "isolated" && STORAGE_CREDENTIALS.has(name)
  );
  if (same) {
    return expectSame
      ? { status: "same", detail: "prod == dev" }
      : {
          status: "same",
          detail: "isolated dev must not reuse the production value",
          blocking: true,
        };
  }
  return expectSame
    ? { status: "different", detail: "prod != dev (content not shown)" }
    : {
        status: "ok",
        detail: "isolated dev uses its own value (content not shown)",
      };
};

const expectedProdVars = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "FILES_SIGNING_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_ENDPOINT",
  "R2_SECRET_ACCESS_KEY",
] as const;

const expectedDevVars = [
  ...expectedProdVars,
  "R2_BUCKET",
  "R2_KEY_PREFIX",
  "FILES_BASE",
] as const;

const log = (
  label: string,
  status: Status,
  detail?: string,
  opts?: { blocking?: boolean }
) => {
  const blocking = isBlockingFinding(status, opts);
  let icon: string;
  if (blocking || status === "missing") {
    icon = "✗";
  } else if (status === "same" || status === "ok") {
    icon = "✓";
  } else {
    icon = "•";
  }
  console.log(`${icon} ${label}: ${status}${detail ? ` (${detail})` : ""}`);
  if (blocking) {
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
    const bucketName = cfg.r2_buckets?.[0]?.bucket_name;
    let bucketStatus: Status = "missing";
    if (bucketName) {
      bucketStatus =
        cfg.r2_buckets.length === 1 && bucketName === PRODUCTION_STORAGE_BUCKET
          ? "ok"
          : "different";
    }
    log("top-level bucket", bucketStatus, bucketName ?? "no bucket");
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
  log(
    "development/.dev.vars",
    existsSync(ISOLATED_DEV_VARS_PATH) ? "ok" : "warn",
    existsSync(ISOLATED_DEV_VARS_PATH)
      ? "present for the isolated development Worker"
      : "not needed until isolated development storage is active",
    { blocking: false }
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
    `  Dev storage: current shared routing (R2_BUCKET=${PRODUCTION_STORAGE_BUCKET}, FILES_BASE=${PRODUCTION_FILES_BASE}) or isolated target (R2_BUCKET=${DEVELOPMENT_STORAGE_BUCKET}, FILES_BASE=${DEVELOPMENT_FILES_ORIGIN}); R2_KEY_PREFIX=dev/ in both`
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

  const routingVars = ["R2_BUCKET", "R2_KEY_PREFIX", "FILES_BASE"] as const;
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
  const deploymentValue = (
    name: (typeof routingVars)[number],
    side: "dev" | "prod"
  ) => {
    const result = deploymentValues.get(name)?.[side];
    return result?.status === "found" ? result.value : undefined;
  };
  const devRouting = routingVars.map(
    (name) => deploymentValues.get(name)?.dev.status
  );
  const devState: DevStorageState | null = devRouting.every(
    (status) => status === "found" || status === "missing"
  )
    ? classifyDevStorage({
        bucket: deploymentValue("R2_BUCKET", "dev"),
        prefix: deploymentValue("R2_KEY_PREFIX", "dev"),
        filesBase: deploymentValue("FILES_BASE", "dev"),
      })
    : null;

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
        log(name, "warn", `Convex ${sideName} deployment unavailable`, {
          blocking: true,
        });
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
    } else {
      const finding = credentialParityFinding(
        name,
        devState,
        prod.value === dev.value
      );
      log(name, finding.status, finding.detail, {
        blocking: finding.blocking,
      });
    }
  }

  const routingResults = (side: "dev" | "prod") =>
    routingVars.map((name) => deploymentValues.get(name)?.[side]);
  const scopeNote = only ? ` (--only ${only})` : "";
  for (const side of ["prod", "dev"] as const) {
    const results = routingResults(side);
    if (results.every((result) => result?.status === "skipped")) {
      continue;
    }
    if (
      results.some(
        (result) => result?.status !== "found" && result?.status !== "missing"
      )
    ) {
      log(`${side} storage routing`, "warn", "Convex deployment unavailable", {
        blocking: only !== null,
      });
      continue;
    }
    if (side === "prod") {
      log(
        "R2_BUCKET (prod)",
        deploymentValue("R2_BUCKET", "prod") === PRODUCTION_STORAGE_BUCKET
          ? "same"
          : "different",
        `must be ${PRODUCTION_STORAGE_BUCKET}${scopeNote}`
      );
      log(
        "FILES_BASE (prod)",
        deploymentValue("FILES_BASE", "prod") === PRODUCTION_FILES_BASE
          ? "same"
          : "different",
        `must be ${PRODUCTION_FILES_BASE}${scopeNote}`
      );
      log(
        "R2_KEY_PREFIX (prod)",
        deploymentValue("R2_KEY_PREFIX", "prod") === undefined
          ? "same"
          : "different",
        `must be unset${scopeNote}`
      );
      continue;
    }
    if (devState === "shared") {
      log(
        "dev storage routing",
        "ok",
        `current shared production Worker and bucket, dev/ prefix${scopeNote}`
      );
      console.log(
        "  Isolation is not active: dev still shares production storage credentials bucket-wide. The prefix is routine-mistake protection, not a security boundary."
      );
    } else if (devState === "isolated") {
      log(
        "dev storage routing",
        "ok",
        `isolated development Worker and bucket, dev/ prefix${scopeNote}`
      );
    } else {
      log(
        "dev storage routing",
        "different",
        `matches neither the current shared routing nor the isolated target${scopeNote}`
      );
    }
  }

  console.log(
    "\n  Shared dev storage requires the production signing key and S3 credentials; isolated dev storage requires its own. Never copy production credentials into isolated development."
  );
  console.log(
    "  Distinct values do not prove bucket-scoped provider permissions; verify those with the provider. --only skips the credential comparison."
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
    "  • Keep `bun run dev --all` for all-surface stack; use `bun run dev files` (remote bindings) vs `bun run dev files:local` (Miniflare, low-fidelity Images)."
  );
  console.log(
    "  • .dev.vars is ignored and per-developer; sync it only from Convex dev (`bun run sync:cloudflare-dev`, or `bun run sync:cloudflare-dev --isolated` once isolation is active)."
  );
  console.log(
    "  • wrangler.jsonc is prod-only. development/wrangler.jsonc is the prepared isolated development Worker; never reuse the retired teak-files-dev bucket."
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
