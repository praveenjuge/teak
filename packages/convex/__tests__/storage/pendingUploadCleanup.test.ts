import { describe, expect, mock, test } from "bun:test";
import {
  runStalePendingCleanup,
  withFilesWorkerRetry,
} from "../../storage/pendingUploadCleanup";

describe("worker-side stale cleanup", () => {
  test("forwards and persists the continuation cursor", async () => {
    const cleanupPage = mock(async () => ({ cursor: "next-page" }));
    const getCursor = mock(async () => "saved-page");
    const setCursor = mock(async () => undefined);

    await runStalePendingCleanup(
      { cleanupPage, getCursor, setCursor },
      Date.UTC(2026, 8, 16)
    );

    expect(cleanupPage).toHaveBeenCalledTimes(200);
    expect(cleanupPage.mock.calls[0]?.[0]).toMatchObject({
      cursor: "saved-page",
      pendingCardId: "upload-pending-v2",
      prefix: "users/",
    });
    expect(setCursor).toHaveBeenCalledWith("next-page");
  });

  test("clears the saved cursor when the scan finishes", async () => {
    const setCursor = mock(async () => undefined);
    await runStalePendingCleanup({
      cleanupPage: mock(async () => ({ cursor: null })),
      getCursor: mock(async () => "saved-page"),
      setCursor,
    });
    expect(setCursor).toHaveBeenCalledWith(null);
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

  test("retries rate-limited responses", async () => {
    let calls = 0;
    const result = await withFilesWorkerRetry(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("files_worker_error:INTERNAL:429:req"));
      }
      return Promise.resolve("ok");
    }, [0]);
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
