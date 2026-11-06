import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pollUntil, sleep } from "./release-cli.ts";

// Each version has one GitHub Release, named after its tag. Version Tag
// creates it right after the tag (`create`); the release workflows only
// upload assets to it, waiting for it first (`wait`) because a tag push can
// start them a moment before the release exists.

type Execute = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; stdio: ["ignore", "pipe", "pipe"] }
) => Pick<SpawnSyncReturns<string>, "error" | "status" | "stderr" | "stdout">;

interface Options {
  execute?: Execute;
  now?: () => number;
  timeoutMs?: number;
  wait?: (ms: number) => Promise<unknown>;
}

const gh = (execute: Execute, args: string[]) =>
  execute("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const failure = (result: ReturnType<Execute>, fallback: string) =>
  new Error(
    result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      fallback
  );

const validated = (repository: string, tag: string) => {
  if (
    !(
      /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) &&
      /^v\d+\.\d+\.\d+$/.test(tag)
    )
  ) {
    throw new Error("Invalid GitHub Release identity.");
  }
};

class ReleaseMissing extends Error {}

/** Resolves when the release exists; a missing one is a `ReleaseMissing`. */
function viewRelease(execute: Execute, repository: string, tag: string) {
  const result = gh(execute, [
    "release",
    "view",
    tag,
    "--repo",
    repository,
    "--json",
    "tagName",
  ]);
  if (result.status === 0) {
    return;
  }
  if (!result.error && /release not found/i.test(result.stderr ?? "")) {
    throw new ReleaseMissing(`GitHub Release ${tag} doesn't exist.`);
  }
  throw failure(result, `Could not read GitHub Release ${tag}.`);
}

/** The release's title and notes, the same for every version. */
export const releaseCreateArgs = (repository: string, tag: string) => [
  "release",
  "create",
  tag,
  "--repo",
  repository,
  "--verify-tag",
  "--title",
  tag,
  "--generate-notes",
];

/** Creates the tag's release unless it exists. */
export function createRelease(
  repository: string,
  tag: string,
  { execute = spawnSync as Execute }: Options = {}
): "created" | "exists" {
  validated(repository, tag);
  try {
    viewRelease(execute, repository, tag);
    return "exists";
  } catch (error) {
    if (!(error instanceof ReleaseMissing)) {
      throw error;
    }
  }
  const result = gh(execute, releaseCreateArgs(repository, tag));
  if (result.status !== 0) {
    throw failure(result, `Could not create GitHub Release ${tag}.`);
  }
  return "created";
}

/** Waits for Version Tag to create the tag's release. */
export async function waitForRelease(
  repository: string,
  tag: string,
  {
    execute = spawnSync as Execute,
    now,
    timeoutMs = 10 * 60_000,
    wait = sleep,
  }: Options = {}
): Promise<void> {
  validated(repository, tag);
  try {
    await pollUntil(() => viewRelease(execute, repository, tag), {
      intervalMs: 15_000,
      timeoutMs,
      now,
      wait,
      retryOn: (error) => error instanceof ReleaseMissing,
      onRetry: () => console.log(`Waiting for GitHub Release ${tag}…`),
    });
  } catch (error) {
    if (error instanceof ReleaseMissing) {
      throw new Error(
        `GitHub Release ${tag} doesn't exist. The Version Tag workflow creates it with the tag; for an older tag, run \`node scripts/release/github-release.ts create ${repository} ${tag}\` and rerun this workflow.`
      );
    }
    throw error;
  }
}

async function main() {
  const [command, repository = "", tag = ""] = process.argv.slice(2);
  if (command === "create") {
    const outcome = createRelease(repository, tag);
    console.log(
      outcome === "created"
        ? `Created GitHub Release ${tag}.`
        : `GitHub Release ${tag} already exists.`
    );
    return;
  }
  if (command === "wait") {
    await waitForRelease(repository, tag);
    return;
  }
  throw new Error("Usage: github-release.ts create|wait <owner/repo> <tag>");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
