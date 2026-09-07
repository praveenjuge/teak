#!/usr/bin/env bun
/**
 * Perform the shared release preparation from docs/agents/releases.md.
 *
 * Updates every tracked package.json to the next patch version, synchronizes
 * bun.lock (and apps/raycast/package-lock.json when present), then verifies
 * with a frozen install and the lockstep validator. Review the diff and
 * commit it as one scoped version change afterwards.
 * Usage: bun run release:prepare <version>
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertLockstep,
  assertPatchBump,
  packageFiles,
} from "./release-version.mjs";

const ROOT = join(import.meta.dir, "..");

export const readVersion = (manifestPath: string): string =>
  JSON.parse(readFileSync(manifestPath, "utf-8")).version;

export const resolveBump = (
  current: string,
  target: string
): "fresh" | "resume" => {
  if (current === target) {
    return "resume";
  }
  assertPatchBump(current, target);
  return "fresh";
};

export const setManifestVersion = (
  manifestPath: string,
  version: string
): void => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

export const updateManifestVersions = (
  repoRoot: string,
  version: string
): string[] => {
  const updated: string[] = [];
  for (const relative of packageFiles(repoRoot)) {
    const absolute = join(repoRoot, relative);
    if (readVersion(absolute) !== version) {
      setManifestVersion(absolute, version);
      updated.push(relative);
    }
  }
  return updated;
};

const run = (cmd: string[], cwd: string): void => {
  console.log(`$ (in ${cwd}) ${cmd.join(" ")}`);
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}`);
  }
};

const main = (): void => {
  const [version] = process.argv.slice(2);
  if (!version) {
    throw new Error("Usage: bun run release:prepare <version>");
  }
  const previous = readVersion(join(ROOT, "package.json"));
  const mode = resolveBump(previous, version);
  if (mode === "resume") {
    console.log(
      `Manifests already at ${version}; resuming install and verification.`
    );
  }

  const updated = updateManifestVersions(ROOT, version);
  console.log(
    updated.length > 0
      ? `Updated ${updated.length} manifests to ${version}.`
      : `All manifests already at ${version}.`
  );

  run(["bun", "install"], ROOT);
  if (existsSync(join(ROOT, "apps/raycast/package-lock.json"))) {
    run(
      ["npm", "install", "--package-lock-only", "--ignore-scripts"],
      join(ROOT, "apps/raycast")
    );
  }

  run(["bun", "install", "--frozen-lockfile"], ROOT);
  assertLockstep(ROOT, version);
  console.log(
    `Lockstep verified at ${version}. Review the diff, then commit the manifests and lockfiles together.`
  );
};

if (import.meta.main) {
  main();
}
