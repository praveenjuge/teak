import { describe, expect, test } from "bun:test";
import { pollUntil } from "./release-cli.ts";

class Pending extends Error {}

/** A clock that moves only when the poll pauses. */
const clock = () => {
  let time = 0;
  const pauses: number[] = [];
  return {
    now: () => time,
    pauses,
    wait: (ms: number) => {
      pauses.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
};

const failing =
  (error: () => Error, succeedOn = Number.POSITIVE_INFINITY) =>
  () => {
    let calls = 0;
    const attempt = () => {
      calls++;
      if (calls >= succeedOn) {
        return calls;
      }
      throw error();
    };
    return { attempt, calls: () => calls };
  };

describe("pollUntil", () => {
  test("retries a pending failure until the attempt succeeds", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Pending(), 3)();
    expect(
      await pollUntil(attempt, {
        intervalMs: 10,
        timeoutMs: 1000,
        retryOn: (error) => error instanceof Pending,
        ...time,
      })
    ).toBe(3);
    expect(calls()).toBe(3);
    expect(time.pauses).toEqual([10, 10]);
  });

  test("throws any other failure at once", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Error("outage"))();
    await expect(
      pollUntil(attempt, {
        intervalMs: 10,
        timeoutMs: 1000,
        retryOn: (error) => error instanceof Pending,
        ...time,
      })
    ).rejects.toThrow("outage");
    expect(calls()).toBe(1);
    expect(time.pauses).toEqual([]);
  });

  test("stops after its attempts and throws the last failure", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Pending("still pending"))();
    await expect(
      pollUntil(attempt, {
        attempts: 4,
        intervalMs: 10,
        timeoutMs: 1000,
        retryOn: () => true,
        ...time,
      })
    ).rejects.toThrow("still pending");
    expect(calls()).toBe(4);
  });

  test("cuts the last pause at the deadline and makes one final attempt", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Pending())();
    await expect(
      pollUntil(attempt, {
        intervalMs: 40,
        timeoutMs: 100,
        retryOn: () => true,
        ...time,
      })
    ).rejects.toBeInstanceOf(Pending);
    expect(time.pauses).toEqual([40, 40, 20]);
    expect(calls()).toBe(4);
  });

  test("without a final attempt, stops when a pause reaches the deadline", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Pending())();
    await expect(
      pollUntil(attempt, {
        finalAttempt: false,
        intervalMs: 40,
        timeoutMs: 100,
        retryOn: () => true,
        ...time,
      })
    ).rejects.toBeInstanceOf(Pending);
    expect(calls()).toBe(3);
  });

  test("a zero timeout makes a single attempt", async () => {
    const time = clock();
    const { attempt, calls } = failing(() => new Pending())();
    await expect(
      pollUntil(attempt, {
        intervalMs: 15_000,
        timeoutMs: 0,
        retryOn: () => true,
        ...time,
      })
    ).rejects.toBeInstanceOf(Pending);
    expect(calls()).toBe(1);
  });

  test("tells each attempt the time left and reports each retry", async () => {
    const time = clock();
    const left: number[] = [];
    const retried: number[] = [];
    await pollUntil(
      (remainingMs) => {
        left.push(remainingMs);
        if (left.length < 3) {
          throw new Pending();
        }
      },
      {
        intervalMs: 30,
        timeoutMs: 100,
        retryOn: () => true,
        onRetry: (_, attempt) => retried.push(attempt),
        ...time,
      }
    );
    expect(left).toEqual([100, 70, 40]);
    expect(retried).toEqual([1, 2]);
  });
});
