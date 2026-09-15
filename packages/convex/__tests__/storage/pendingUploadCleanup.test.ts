import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withFilesWorkerRetry } from "../../storage/pendingUploadCleanup";

describe("worker-side stale cleanup", () => {
  test("uses the bounded page operation instead of remote delete batches", async () => {
    const source = readFileSync(
      new URL("../../storage/pendingUploadCleanup.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain('op: "cleanup-stale-pending-upload-page"');
    expect(source).not.toContain('op: "delete-objects"');
  });
});

describe("withFilesWorkerRetry", () => {
  test("retries transient network errors until the call succeeds", async () => {
    let calls = 0;
    const result = await withFilesWorkerRetry(() => {
      calls += 1;
      if (calls < 3) {
        return Promise.reject(
          new Error("files_worker_network_error:fetch failed")
        );
      }
      return Promise.resolve("ok");
    }, [0, 0]);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("retries transient 5xx responses", async () => {
    let calls = 0;
    const result = await withFilesWorkerRetry(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          new Error("files_worker_error:INTERNAL:500:req-1")
        );
      }
      return Promise.resolve("ok");
    }, [0, 0]);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  test("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      withFilesWorkerRetry(() => {
        calls += 1;
        return Promise.reject(
          new Error("files_worker_error:UNAUTHORIZED:401:req-1")
        );
      }, [0, 0])
    ).rejects.toThrow("files_worker_error:UNAUTHORIZED:401:req-1");
    expect(calls).toBe(1);
  });

  test("stops retrying when the shared budget is exhausted", async () => {
    const budget = { remainingMs: 5 };
    let calls = 0;
    await expect(
      withFilesWorkerRetry(
        () => {
          calls += 1;
          return Promise.reject(
            new Error("files_worker_network_error:fetch failed")
          );
        },
        [3, 3],
        budget
      )
    ).rejects.toThrow("files_worker_network_error:fetch failed");
    expect(calls).toBe(2);
    expect(budget.remainingMs).toBe(2);
  });

  test("gives up after the retry budget", async () => {
    let calls = 0;
    await expect(
      withFilesWorkerRetry(() => {
        calls += 1;
        return Promise.reject(
          new Error("files_worker_network_error:fetch failed")
        );
      }, [0, 0])
    ).rejects.toThrow("files_worker_network_error:fetch failed");
    expect(calls).toBe(3);
  });
});
