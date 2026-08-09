import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  const match = semverPattern.exec(value);
  if (!match) {
    throw new Error(
      `Expected a three-component semantic version, received: ${value}`
    );
  }
  return match.slice(1).map(Number);
}

export function assertPatchBump(previous, next) {
  const [previousMajor, previousMinor, previousPatch] = parseVersion(previous);
  const [nextMajor, nextMinor, nextPatch] = parseVersion(next);
  if (
    nextMajor !== previousMajor ||
    nextMinor !== previousMinor ||
    nextPatch !== previousPatch + 1
  ) {
    throw new Error(
      `Release version must be the next patch after ${previous}; received ${next}.`
    );
  }
}

export function packageFiles(repoRoot) {
  const files = ["package.json"];
  for (const directory of ["apps", "packages"]) {
    const parent = path.join(repoRoot, directory);
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const relative = `${directory}/${entry.name}/package.json`;
      if (fs.existsSync(path.join(repoRoot, relative))) {
        files.push(relative);
      }
    }
  }
  return files.sort();
}

export function npmLockFiles(repoRoot) {
  return packageFiles(repoRoot)
    .map((relative) => path.join(path.dirname(relative), "package-lock.json"))
    .filter((relative) => fs.existsSync(path.join(repoRoot, relative)))
    .sort();
}

export function assertLockstep(repoRoot, expectedVersion) {
  parseVersion(expectedVersion);
  const mismatches = [];
  for (const relative of packageFiles(repoRoot)) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, relative), "utf8")
    );
    if (manifest.version !== expectedVersion) {
      mismatches.push(`${relative}: ${manifest.version ?? "missing"}`);
    }
  }
  for (const relative of npmLockFiles(repoRoot)) {
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(repoRoot, relative), "utf8")
    );
    const versions = [
      ["version", lockfile.version],
      ['packages[""].version', lockfile.packages?.[""]?.version],
    ];
    for (const [field, version] of versions) {
      if (version !== expectedVersion) {
        mismatches.push(`${relative} ${field}: ${version ?? "missing"}`);
      }
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Every package manifest and npm lockfile must use ${expectedVersion}:\n${mismatches.join("\n")}`
    );
  }
}

function usage() {
  throw new Error(
    "Usage: node scripts/release-version.mjs version <version> | lockstep <version> | patch <previous> <next>"
  );
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const [command, first, second] = process.argv.slice(2);
  if (command === "version" && first && !second) {
    parseVersion(first);
    console.log(`${first} is a valid release version.`);
    return;
  }
  if (command === "lockstep" && first && !second) {
    assertLockstep(repoRoot, first);
    console.log(
      `All package manifests and npm lockfiles are lockstep at ${first}.`
    );
    return;
  }
  if (command === "patch" && first && second) {
    assertPatchBump(first, second);
    console.log(`${second} is the next patch after ${first}.`);
    return;
  }
  usage();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
