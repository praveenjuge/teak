import { describe, expect, test, vi } from "vitest";
import {
  ACCOUNT_DELETION_OCC_RETRY_DELAYS_MS,
  isOptimisticConcurrencyConflict,
  withOptimisticConcurrencyRetry,
} from "./accountDeletion";

const conflictError = () =>
  new Error(
    'Documents read from or written to the "cardSearchTagSyncStates" table ' +
      "changed while this mutation was being run and on every subsequent " +
      'retry. A call to "scheduled_job_mutation_success" changed the ' +
      'document with ID "abc123". See https://docs.convex.dev/error#1'
  );

describe("isOptimisticConcurrencyConflict", () => {
  test("matches the production conflict message", () => {
    expect(isOptimisticConcurrencyConflict(conflictError())).toBe(true);
  });

  test("rejects unrelated errors and non-error values", () => {
    expect(isOptimisticConcurrencyConflict(new Error("boom"))).toBe(false);
    expect(isOptimisticConcurrencyConflict("changed while this")).toBe(false);
    expect(isOptimisticConcurrencyConflict(null)).toBe(false);
    expect(isOptimisticConcurrencyConflict(undefined)).toBe(false);
  });
});

describe("withOptimisticConcurrencyRetry", () => {
  test("returns the first success without sleeping", async () => {
    const sleep = vi.fn(async (_delayMs: number) => {});
    const result = await withOptimisticConcurrencyRetry(
      () => Promise.resolve("done"),
      { sleep }
    );
    expect(result).toBe("done");
    expect(sleep).not.toHaveBeenCalled();
  });

  test("backs off and retries conflicts until the run succeeds", async () => {
    const sleep = vi.fn(async (_delayMs: number) => {});
    let attempts = 0;
    const result = await withOptimisticConcurrencyRetry(
      () => {
        attempts += 1;
        if (attempts < 3) {
          return Promise.reject(conflictError());
        }
        return Promise.resolve("done");
      },
      { sleep }
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      ACCOUNT_DELETION_OCC_RETRY_DELAYS_MS.slice(0, 2)
    );
  });

  test("rethrows non-conflict errors without retrying", async () => {
    const sleep = vi.fn(async (_delayMs: number) => {});
    let attempts = 0;
    await expect(
      withOptimisticConcurrencyRetry(
        () => {
          attempts += 1;
          return Promise.reject(new Error("quota exceeded"));
        },
        { sleep }
      )
    ).rejects.toThrow("quota exceeded");
    expect(attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("gives up once the configured delays are exhausted", async () => {
    const sleep = vi.fn(async (_delayMs: number) => {});
    let attempts = 0;
    await expect(
      withOptimisticConcurrencyRetry(
        () => {
          attempts += 1;
          return Promise.reject(conflictError());
        },
        { retryDelaysMs: [1, 2], sleep }
      )
    ).rejects.toThrow(/changed while this/);
    expect(attempts).toBe(3);
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([1, 2]);
  });
});
