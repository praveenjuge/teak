#!/usr/bin/env bun
/**
 * One-command repository bootstrap.
 *
 * Idempotent: never overwrites existing files, only creates what is missing.
 * Usage: bun run setup [--check]
 *   --check  report what setup would do without writing or installing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WEB_ENV_PATH = join(ROOT, "apps/web/.env.local");

export const webEnvTemplate = (): string =>
  [
    "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210",
    "NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211",
    "",
  ].join("\n");

export const requiredBunVersion = (packageManager: string): string => {
  const version = packageManager.replace(/^bun@/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Cannot parse Bun version from "${packageManager}".`);
  }
  return version;
};

export const checkBunVersion = (
  current: string,
  required: string
): "ok" | "warn" | "mismatch" => {
  if (current === required) {
    return "ok";
  }
  const [cMajor, cMinor] = current.split(".");
  const [rMajor, rMinor] = required.split(".");
  if (cMajor === rMajor && cMinor === rMinor) {
    return "warn";
  }
  return "mismatch";
};

export const ensureFile = (
  path: string,
  content: string
): "created" | "exists" => {
  if (existsSync(path)) {
    return "exists";
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return "created";
};

const runInstall = (root: string): void => {
  const result = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error("bun install --frozen-lockfile failed.");
  }
};

const main = (): void => {
  const checkOnly = process.argv.includes("--check");
  const rootManifest = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  );
  const required = requiredBunVersion(rootManifest.packageManager);
  const status = checkBunVersion(Bun.version, required);
  console.log(`Bun ${status}: current ${Bun.version}, required ${required}.`);
  if (status === "mismatch") {
    throw new Error(
      `Install Bun ${required} (see packageManager in package.json).`
    );
  }

  if (existsSync(join(ROOT, "node_modules"))) {
    console.log("Dependencies: node_modules present.");
  } else if (checkOnly) {
    console.log("Would run: bun install --frozen-lockfile");
  } else {
    runInstall(ROOT);
  }

  if (checkOnly) {
    console.log(
      existsSync(WEB_ENV_PATH)
        ? "Web env: apps/web/.env.local present."
        : "Would create: apps/web/.env.local (local Convex URLs)"
    );
  } else {
    console.log(
      `Web env: apps/web/.env.local ${ensureFile(WEB_ENV_PATH, webEnvTemplate())}.`
    );
  }

  console.log("Next steps:");
  console.log("  1. bun run doctor      # validate the environment");
  console.log("  2. bun run dev         # web + Convex");
  console.log(
    "  3. bunx convex dev     # first run only: Convex login + deployment"
  );
  console.log("     bunx convex env set SITE_URL http://localhost:3000");
};

if (import.meta.main) {
  main();
}
