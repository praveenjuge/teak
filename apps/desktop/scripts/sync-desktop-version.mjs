#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const NEXT_VERSION = process.argv[2]?.trim();

if (!NEXT_VERSION) {
  console.error(
    "Usage: bun run --filter @teak/desktop version:sync -- <version>"
  );
  process.exit(1);
}

const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!SEMVER_PATTERN.test(NEXT_VERSION)) {
  console.error(`Invalid semver version: ${NEXT_VERSION}`);
  process.exit(1);
}

const desktopRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(desktopRoot, "package.json");
const tauriConfigPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(desktopRoot, "src-tauri", "Cargo.toml");

const packageJsonRaw = await readFile(packageJsonPath, "utf8");
const packageJson = JSON.parse(packageJsonRaw);
packageJson.version = NEXT_VERSION;

const tauriConfigRaw = await readFile(tauriConfigPath, "utf8");
const tauriConfig = JSON.parse(tauriConfigRaw);
tauriConfig.version = NEXT_VERSION;

const cargoTomlRaw = await readFile(cargoTomlPath, "utf8");
const packageBlockPattern = /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(".*$)/m;
if (!packageBlockPattern.test(cargoTomlRaw)) {
  console.error("Unable to find [package] version in Cargo.toml");
  process.exit(1);
}
const cargoTomlNext = cargoTomlRaw.replace(
  packageBlockPattern,
  `$1${NEXT_VERSION}$2`
);

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
await writeFile(cargoTomlPath, cargoTomlNext);

console.log(`Synchronized desktop version to ${NEXT_VERSION}`);
