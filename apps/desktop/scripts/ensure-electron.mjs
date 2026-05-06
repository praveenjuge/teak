#!/usr/bin/env node
/**
 * Electron Forge's dependency resolver (`@electron-forge/core-utils`)
 * walks up looking for `package-lock.json`, `yarn.lock`, or
 * `pnpm-lock.yaml` to find the monorepo root. Teak uses `bun.lock`,
 * which Forge does not recognize — so it only checks the app's own
 * `node_modules/` and never reaches the hoisted root copy.
 *
 * Bun's hoisted linker installs `electron` at the repo root, so this
 * script creates a local symlink `apps/desktop/node_modules/electron`
 * pointing at the hoisted copy. Forge then finds it via its first
 * check (app-local `node_modules`) and skips the ancestor walk.
 *
 * Idempotent: does nothing if the symlink or a real install is already
 * in place. Safe to run on every `bun run dev` / `bun run build`.
 */
import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const workspaceRoot = resolve(desktopRoot, "..", "..");

const target = resolve(desktopRoot, "node_modules", "electron");
const source = resolve(workspaceRoot, "node_modules", "electron");

if (!existsSync(source)) {
  console.error(
    `[ensure-electron] Root electron not found at ${source}. ` +
      `Run \`bun install\` from the repo root first.`
  );
  process.exit(1);
}

try {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    // Already linked or installed. Nothing to do.
    process.exit(0);
  }
} catch {
  // Target does not exist; fall through and create the symlink.
}

mkdirSync(dirname(target), { recursive: true });
symlinkSync(
  source,
  target,
  process.platform === "win32" ? "junction" : "dir"
);
console.log(`[ensure-electron] linked ${target} → ${source}`);
