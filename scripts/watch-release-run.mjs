import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Observing a dispatched run never redispatches or restarts its workflow.
export async function watchReleaseRun(
  repository,
  runId,
  {
    execute = spawnSync,
    wait = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = {}
) {
  if (
    !(
      /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository) &&
      /^[1-9]\d*$/.test(runId)
    )
  ) {
    throw new Error("Invalid release workflow identity.");
  }
  for (let attempt = 0; attempt < 15; attempt++) {
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
    if (
      !result.error &&
      /^failed to get run: HTTP 404: Not Found\b/m.test(result.stderr ?? "") &&
      attempt < 14
    ) {
      await wait(2000);
      continue;
    }
    throw new Error(
      result.error?.message ||
        result.stderr ||
        result.stdout ||
        `Release workflow ${runId} failed.`
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await watchReleaseRun(process.argv[2], process.argv[3]);
}
