#!/usr/bin/env bun
/**
 * Build metadata derivation (issue #407, Phase 3).
 *
 * Release IDs, app versions, and commit SHAs derive from provider metadata
 * instead of manual configuration. Precedence for the commit SHA:
 * explicit GIT_SHA override, GitHub, Vercel, then the local git checkout.
 * Names and metadata only; SHAs are not secrets but are still never logged
 * beyond the release identifiers that need them.
 *
 * Usage: bun run scripts/build-metadata.ts --json
 *        bun run scripts/build-metadata.ts --release <prefix>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./proc.ts";

const ROOT = join(import.meta.dir, "..");

export type ShaSource =
  | "GIT_SHA"
  | "GITHUB_SHA"
  | "VERCEL_GIT_COMMIT_SHA"
  | "git";

export interface CommitSha {
  sha: string;
  source: ShaSource;
}

export const resolveCommitShaFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): CommitSha | null => {
  const override = env.GIT_SHA?.trim();
  if (override) {
    return { sha: override, source: "GIT_SHA" };
  }
  const github = env.GITHUB_SHA?.trim();
  if (github) {
    return { sha: github, source: "GITHUB_SHA" };
  }
  const vercel = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercel) {
    return { sha: vercel, source: "VERCEL_GIT_COMMIT_SHA" };
  }
  return null;
};

export const resolveCommitSha = async (
  env: NodeJS.ProcessEnv = process.env,
  root: string = ROOT
): Promise<CommitSha | null> => {
  const fromEnv = resolveCommitShaFromEnv(env);
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const result = await runCommand(["git", "rev-parse", "HEAD"], {
      cwd: root,
      timeoutMs: 10_000,
    });
    const sha = result.stdout.trim();
    if (result.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha)) {
      return { sha, source: "git" };
    }
  } catch {
    // No git checkout available; the caller decides how to fail.
  }
  return null;
};

export const readAppVersion = (root: string = ROOT): string =>
  (
    JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
      version: string;
    }
  ).version;

export const buildRelease = (prefix: string, sha: string): string =>
  `${prefix}@${sha}`;

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const releaseIndex = args.indexOf("--release");
  if (releaseIndex >= 0) {
    const prefix = args[releaseIndex + 1];
    if (!prefix) {
      console.error("usage: build-metadata.ts --release <prefix>");
      process.exitCode = 1;
      return;
    }
    const resolved = await resolveCommitSha();
    if (!resolved) {
      console.error(
        "build-metadata: no commit SHA available (set GIT_SHA or run in a git checkout)"
      );
      process.exitCode = 1;
      return;
    }
    console.log(buildRelease(prefix, resolved.sha));
    return;
  }
  const resolved = await resolveCommitSha();
  console.log(
    JSON.stringify(
      {
        version: 1,
        sha: resolved?.sha ?? null,
        source: resolved?.source ?? null,
        appVersion: readAppVersion(),
      },
      null,
      2
    )
  );
};

if (import.meta.main) {
  await main();
}
