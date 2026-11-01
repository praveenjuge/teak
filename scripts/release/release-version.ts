import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const appleSafariManifest =
  "apps/apple/SafariExtension/Resources/manifest.json";
const mcpServerManifest = "server.json";
const claudePluginManifest = "plugins/teak/.claude-plugin/plugin.json";
// project.yml is the source of truth; Teak.xcodeproj is generated from it, so
// both carry the same MARKETING_VERSION. Build numbers come from App Store
// Connect at release time.
export const appleVersionSources = [
  "apps/apple/project.yml",
  "apps/apple/Teak.xcodeproj/project.pbxproj",
];
const appleMarketingVersionPattern = /(MARKETING_VERSION(?:: | = ))([^;\s]+)/g;

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

export function releaseManifestFiles(repoRoot) {
  const files = packageFiles(repoRoot);
  files.push(appleSafariManifest, mcpServerManifest, claudePluginManifest);
  return files.sort();
}

export function appleMarketingVersions(contents) {
  return [...contents.matchAll(appleMarketingVersionPattern)].map(
    (match) => match[2]
  );
}

export function replaceAppleMarketingVersions(contents, version) {
  return contents.replace(
    appleMarketingVersionPattern,
    (_match, prefix) => `${prefix}${version}`
  );
}

export function assertLockstep(repoRoot, expectedVersion) {
  parseVersion(expectedVersion);
  const mismatches: string[] = [];
  for (const relative of releaseManifestFiles(repoRoot)) {
    let manifest: { version?: string };
    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(repoRoot, relative), "utf8")
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        mismatches.push(`${relative}: missing`);
        continue;
      }
      throw error;
    }
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
  for (const relative of appleVersionSources) {
    let contents: string;
    try {
      // A fixed list of version files inside the repository.
      // nosemgrep: javascript_pathtraversal_rule-non-literal-fs-filename
      contents = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        mismatches.push(`${relative}: missing`);
        continue;
      }
      throw error;
    }
    const versions = appleMarketingVersions(contents);
    if (versions.length === 0) {
      mismatches.push(`${relative} MARKETING_VERSION: missing`);
    }
    for (const version of new Set(versions)) {
      if (version !== expectedVersion) {
        mismatches.push(`${relative} MARKETING_VERSION: ${version}`);
      }
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Every release version source must use ${expectedVersion}:\n${mismatches.join("\n")}`
    );
  }
}

function usage() {
  throw new Error(
    "Usage: node scripts/release/release-version.ts version <version> | lockstep <version> | patch <previous> <next>"
  );
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const [command, first, second] = process.argv.slice(2);
  if (command === "version" && first && !second) {
    parseVersion(first);
    console.log(`${first} is a valid release version.`);
    return;
  }
  if (command === "lockstep" && first && !second) {
    assertLockstep(repoRoot, first);
    console.log(`All release version sources are lockstep at ${first}.`);
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
