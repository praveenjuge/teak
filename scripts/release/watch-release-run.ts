import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pollUntil, sleep } from "./release-cli.ts";

type Execute = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    maxBuffer: number;
    stdio: ["ignore", "inherit", "pipe"];
  }
) => Pick<SpawnSyncReturns<string>, "error" | "status" | "stderr" | "stdout">;

class RunNotFoundYet extends Error {}

export async function watchReleaseRun(
  repository: string,
  runId: string,
  {
    execute = spawnSync as Execute,
    wait = sleep,
  }: { execute?: Execute; wait?: (ms: number) => Promise<void> } = {}
) {
  if (
    !(
      /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) &&
      /^[1-9]\d*$/.test(runId)
    )
  ) {
    throw new Error("Invalid release workflow identity.");
  }
  // A run GitHub just created can answer 404 for a few seconds.
  await pollUntil(
    () => {
      const result = execute(
        "gh",
        ["run", "watch", runId, "--repo", repository, "--exit-status"],
        {
          encoding: "utf8",
          stdio: ["ignore", "inherit", "pipe"],
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      if (result.status === 0) {
        return;
      }
      const message =
        result.error?.message ||
        result.stderr ||
        result.stdout ||
        `Release workflow ${runId} failed.`;
      if (
        !result.error &&
        /^failed to get run: HTTP 404: Not Found\b/m.test(result.stderr ?? "")
      ) {
        throw new RunNotFoundYet(message);
      }
      throw new Error(message);
    },
    {
      attempts: 15,
      intervalMs: 2000,
      // `gh run watch` blocks until the run ends, so time bounds only the
      // retries; the attempts cap how long a missing run is waited for.
      timeoutMs: Number.POSITIVE_INFINITY,
      retryOn: (error) => error instanceof RunNotFoundYet,
      wait,
    }
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await watchReleaseRun(process.argv[2], process.argv[3]);
}
