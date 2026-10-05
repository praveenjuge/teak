import { expect, test } from "bun:test";
import { watchReleaseRun } from "./watch-release-run.mjs";

// Failure modes: eventual-consistency404, permanently missing run, authorization
// failure, child workflow failure, or unsafe CLI argument identity.
test("release observation retries only a transient missing run", async () => {
  let observations = 0;
  await watchReleaseRun("praveenjuge/teak", "123", {
    execute: () =>
      ++observations === 1
        ? {
            status: 1,
            stderr:
              "failed to get run: HTTP 404: Not Found (https://api.github.com/repos/praveenjuge/teak/actions/runs/123)",
            stdout: "",
          }
        : { status: 0, stderr: "", stdout: "" },
    wait: async () => {},
  });
  expect(observations).toBe(2);
});

test.each([
  "HTTP 403: Forbidden",
  "Workflow failed",
  "failed to get run: HTTP 500: Server Error",
])("release observation fails immediately for %s", async (stderr) => {
  await expect(
    watchReleaseRun("praveenjuge/teak", "123", {
      execute: () => ({ status: 1, stderr, stdout: "" }),
      wait: () => Promise.reject(new Error("unexpected retry")),
    })
  ).rejects.toThrow(stderr);
});

test("permanently missing release observation has a bounded retry window", async () => {
  let observations = 0;
  await expect(
    watchReleaseRun("praveenjuge/teak", "123", {
      execute: () => {
        observations++;
        return {
          status: 1,
          stderr: "failed to get run: HTTP 404: Not Found",
          stdout: "",
        };
      },
      wait: async () => {},
    })
  ).rejects.toThrow("HTTP 404");
  expect(observations).toBe(15);
});

test.each([
  ["../other", "123"],
  ["praveenjuge/teak", "--help"],
])(
  "release observation rejects unsafe identity %s %s",
  async (repository, runId) => {
    await expect(watchReleaseRun(repository, runId)).rejects.toThrow(
      "Invalid release workflow identity"
    );
  }
);
