import { describe, expect, spyOn, test } from "bun:test";
import { createFakeBatch, createFakeQueue } from "../test/fakeQueue";
import { FakeBucket } from "../test/testsupport";
import type { FilesOpCaller } from "../workflows/deps";
import { callFilesOp } from "../workflows/filesOps";
import type { BackgroundEnv } from "../workflows/runtime";
import { handleQueueBatch } from "./index";
import {
  handleObjectDeletionBatch,
  queueObjectDeletions,
} from "./objectDeletions";

const key = (index: number) => `users/u1/cards/c1/file/${String(index)}.png`;

const setup = () => {
  const bucket = new FakeBucket();
  for (let index = 0; index < 250; index += 1) {
    bucket.objects.set(key(index), { bytes: new Uint8Array([1]) });
  }
  const env = {
    BUCKET: bucket as unknown as R2Bucket,
    FILES_SIGNING_SECRET: "secret",
  } as BackgroundEnv;
  return { bucket, env };
};

const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

describe("object deletion consumer", () => {
  test("deletes each message's keys and acknowledges it", async () => {
    const { bucket, env } = setup();
    const { batch, outcomes } = createFakeBatch("teak-object-deletions", [
      { keys: [key(0), key(1)] },
      { keys: [key(2)] },
    ]);

    await handleQueueBatch(batch, env, ctx);

    expect(outcomes()).toEqual(["ack", "ack"]);
    expect(bucket.deleteBatches).toEqual([[key(0), key(1)], [key(2)]]);
    expect(bucket.objects.has(key(0))).toBe(false);
  });

  test("retries only the message whose delete failed", async () => {
    const { bucket, env } = setup();
    const { batch, outcomes } = createFakeBatch("teak-dev-object-deletions", [
      { keys: [key(0)] },
      { keys: [key(1)] },
    ]);
    const ops: FilesOpCaller = (spec) =>
      (spec.params.keys as string[]).includes(key(1))
        ? Promise.reject(new Error("r2 unavailable"))
        : callFilesOp(env, spec);

    await handleObjectDeletionBatch(batch, env, ops);

    expect(outcomes()).toEqual(["ack", "retry"]);
    expect(bucket.objects.has(key(1))).toBe(true);
  });

  test("drops keys outside the storage namespace instead of retrying forever", async () => {
    const { bucket, env } = setup();
    const { batch, outcomes } = createFakeBatch("teak-object-deletions", [
      { keys: ["../etc/passwd", key(3)] },
      { nonsense: true },
    ]);

    await handleQueueBatch(batch, env, ctx);

    expect(outcomes()).toEqual(["ack", "ack"]);
    expect(bucket.deleteBatches).toEqual([[key(3)]]);
  });

  test("dead letters are acknowledged after they are logged without their keys", async () => {
    const { bucket, env } = setup();
    const { batch, outcomes } = createFakeBatch("teak-object-deletions-dlq", [
      { keys: [key(0)] },
    ]);
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await handleQueueBatch(batch, env, ctx);
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).toContain('"cardId":"c1"');
      expect(logged).not.toContain(key(0));
      expect(logged).not.toContain("u1");
    } finally {
      errors.mockRestore();
    }

    expect(outcomes()).toEqual(["ack"]);
    expect(bucket.objects.has(key(0))).toBe(true);
  });
});

describe("queueObjectDeletions", () => {
  test("sends at most a hundred keys per message", async () => {
    const { env } = setup();
    const queue = createFakeQueue();
    const keys = Array.from({ length: 250 }, (_, index) => key(index));

    expect(
      await queueObjectDeletions(
        { ...env, OBJECT_DELETIONS: queue.queue as never },
        [...keys, key(0), undefined, "elsewhere/x"]
      )
    ).toBe(250);

    expect(
      queue.sent.map((message) => (message.body as { keys: string[] }).keys)
    ).toEqual([keys.slice(0, 100), keys.slice(100, 200), keys.slice(200)]);
  });

  test("without the queue, deletes at once", async () => {
    const { bucket, env } = setup();

    await queueObjectDeletions(env, [key(5)]);

    expect(bucket.objects.has(key(5))).toBe(false);
  });
});
