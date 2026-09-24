/**
 * Pre-commit guard: reject a bun.lock that doesn't match the manifests being
 * committed.
 *
 * Sep 24, 2026: a workspace-scoped `bun add` in apps/docs committed a bun.lock
 * whose hoisting a root install disagrees with, and every frozen install on
 * main failed. Two details matter:
 *
 * - The check runs against the staged snapshot (index), not the working
 *   tree, so a staged manifest with an unstaged lockfile update is caught.
 * - bun.lock layout is Bun-version-specific, so the check refuses to run
 *   under a Bun other than the `packageManager` pin CI uses.
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SNAPSHOT_FILE_RE = /(^|\/)package\.json$|^bun\.lock$|^bunfig\.toml$/;
export const FROZEN_CHECK = ["install", "--frozen-lockfile", "--lockfile-only"];

export const pinnedBunVersion = (packageJson: string): string | undefined =>
  /^bun@(.+)$/.exec(JSON.parse(packageJson).packageManager ?? "")?.[1];

export const isSnapshotFile = (path: string): boolean =>
  SNAPSHOT_FILE_RE.test(path);

const git = (args: string[]): string => {
  const result = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
};

/** Write the staged version of every install-relevant file into `dir`. */
export const writeStagedSnapshot = (dir: string): void => {
  const files = git(["ls-files", "--cached"])
    .split("\n")
    .filter(isSnapshotFile);
  for (const file of files) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), git(["show", `:${file}`]));
  }
};

export interface FrozenCheckResult {
  ok: boolean;
  output: string;
}

export const runFrozenCheck = (dir: string): FrozenCheckResult => {
  const result = spawnSync(process.execPath, FROZEN_CHECK, {
    cwd: dir,
    encoding: "utf-8",
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim(),
  };
};

const main = (): number => {
  const pinned = pinnedBunVersion(
    readFileSync(join(ROOT, "package.json"), "utf-8")
  );
  if (pinned && pinned !== Bun.version) {
    console.error(
      `bun.lock check needs Bun ${pinned} (package.json packageManager), found ${Bun.version}. ` +
        "Lockfile layout differs between Bun versions; install the pinned Bun and retry."
    );
    return 1;
  }
  const dir = mkdtempSync(join(tmpdir(), "teak-lockfile-"));
  try {
    writeStagedSnapshot(dir);
    const result = runFrozenCheck(dir);
    if (!result.ok) {
      console.error(
        `Staged bun.lock is out of sync with the staged package.json files.\n${result.output}\n` +
          "Run `bun install` at the repo root and stage bun.lock."
      );
      return 1;
    }
    return 0;
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

if (import.meta.main) {
  process.exit(main());
}
