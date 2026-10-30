import { describe, expect, test } from "bun:test";
import { createFakeQueue } from "../test/fakeQueue";
import { planSendBatches, sendInBatches } from "./sendBatch";

const deletion = (index: number) => ({
  keys: Array.from(
    { length: 100 },
    (_, key) =>
      `users/${"u".repeat(32)}/cards/${"c".repeat(32)}/file/${String(index)}-${String(key)}-${"x".repeat(60)}.png`
  ),
});

describe("planSendBatches", () => {
  test("keeps each send under the Queues size limit", () => {
    const bodies = Array.from({ length: 40 }, (_, index) => deletion(index));
    const batches = planSendBatches(bodies);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(bodies.map((_, index) => index));
    for (const batch of batches) {
      const bytes = batch.reduce(
        (total, index) => total + JSON.stringify(bodies[index]).length,
        0
      );
      expect(bytes).toBeLessThanOrEqual(200 * 1024);
    }
  });

  test("keeps each send to a hundred messages", () => {
    const batches = planSendBatches(Array.from({ length: 250 }, () => ({})));
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });
});

describe("sendInBatches", () => {
  test("reports only the bodies whose send failed", async () => {
    const queue = createFakeQueue();
    let sends = 0;
    const flaky = {
      sendBatch: (messages: Array<{ body: unknown }>) => {
        sends += 1;
        return sends === 2
          ? Promise.reject(new Error("queue_down"))
          : queue.queue.sendBatch(messages as never);
      },
    } as unknown as Queue<unknown>;
    const failed = await sendInBatches(
      flaky,
      Array.from({ length: 250 }, (_, index) => ({ index }))
    );
    expect([...failed.keys()]).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 100)
    );
    expect(failed.get(100)).toBe("queue_down");
  });
});
