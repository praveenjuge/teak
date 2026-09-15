import { describe, expect, test } from "bun:test";
import {
  buildStalePendingCleanupSpec,
  withTransientFilesWorkerRetry,
} from "../../storage/pendingUploadCleanup";

describe("buildStalePendingCleanupSpec", () => {
  test("moves the whole stale-object sweep behind one worker operation", () => {
    const now = Date.UTC(2026, 8, 15, 4, 30);
    expect(buildStalePendingCleanupSpec(now)).toEqual({
      op: "cleanup-stale-pending-uploads",
      params: {
        pendingCardId: "upload-pending-v2",
        prefix: "users/",
        staleBefore: now - 24 * 60 * 60 * 1000,
      },
    });
  });
});

describe("withTransientFilesWorkerRetry", () => {
  test("retries transient worker failures", async () => {
    let calls = 0;
    const result = await withTransientFilesWorkerRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("files_worker_network_error:reset");
      }
      return "ok";
    }, [0, 0]);
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("retries rate-limited worker failures", async () => {
    let calls = 0;
    const result = await withTransientFilesWorkerRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("files_worker_error:INTERNAL:429:req");
      }
      return "ok";
    }, [0]);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  test("does not retry non-transient failures", async () => {
    let calls = 0;
    await expect(
      withTransientFilesWorkerRetry(async () => {
        calls += 1;
        throw new Error("files_worker_error:UNAUTHORIZED:401:req");
      }, [0, 0])
    ).rejects.toThrow("UNAUTHORIZED");
    expect(calls).toBe(1);
  });
});
