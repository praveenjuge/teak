import { describe, expect, test } from "bun:test";
import { createFakeBatch, createFakeQueue } from "../test/fakeQueue";
import { FakeBucket } from "../test/testsupport";
import type { BackgroundEnv } from "../workflows/runtime";
import {
  handleR2EventsBatch,
  MAX_QUEUE_DELAY_SECONDS,
  PENDING_UPLOAD_STALE_AFTER_MS,
  sweepStalePendingUploads,
} from "./r2Events";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-16T12:00:00Z");
const PENDING = "users/u1/cards/upload-pending-v2/file/photo.jpg";
const DEV_PENDING = "dev/users/u1/cards/upload-pending-v2/file/photo.jpg";

const created = (key: string, uploadedAt: number, action = "PutObject") => ({
  account: "account",
  action,
  bucket: "teak-files-prod",
  eventTime: new Date(uploadedAt).toISOString(),
  object: { eTag: "etag", key, size: 1 },
});

const setup = () => {
  const bucket = new FakeBucket();
  const events = createFakeQueue();
  const env = {
    BUCKET: bucket as unknown as R2Bucket,
    R2_EVENTS: events.queue,
  };
  return { bucket, env, events };
};

describe("pending upload events", () => {
  test("a new pending upload is held for 12 hours, then until it is 24 hours old", async () => {
    const { env, events } = setup();
    const first = createFakeBatch("teak-r2-events", [created(PENDING, NOW)]);
    await handleR2EventsBatch(first.batch, env, NOW);
    expect(first.outcomes()).toEqual(["ack"]);
    expect(events.sent).toEqual([
      {
        body: { key: PENDING, kind: "pending-upload-check", uploadedAt: NOW },
        delaySeconds: MAX_QUEUE_DELAY_SECONDS,
      },
    ]);

    const later = NOW + 15 * HOUR_MS;
    const second = createFakeBatch("teak-r2-events", [events.sent[0]?.body]);
    await handleR2EventsBatch(second.batch, env, later);
    expect(second.outcomes()).toEqual(["ack"]);
    expect(events.sent[1]?.delaySeconds).toBe(9 * 60 * 60);
  });

  test("deletes a pending upload still there after 24 hours", async () => {
    const { bucket, env, events } = setup();
    bucket.objects.set(PENDING, {
      bytes: new Uint8Array([1]),
      uploadedAt: NOW,
    });
    const due = NOW + PENDING_UPLOAD_STALE_AFTER_MS;
    const { batch, outcomes } = createFakeBatch("teak-r2-events", [
      { key: PENDING, kind: "pending-upload-check", uploadedAt: NOW },
    ]);
    await handleR2EventsBatch(batch, env, due);
    expect(outcomes()).toEqual(["ack"]);
    expect(bucket.objects.has(PENDING)).toBe(false);
    expect(events.sent).toEqual([]);
  });

  test("keeps an object written again since the event", async () => {
    const { bucket, env } = setup();
    bucket.objects.set(DEV_PENDING, {
      bytes: new Uint8Array([1]),
      uploadedAt: NOW + 20 * HOUR_MS,
    });
    const { batch, outcomes } = createFakeBatch("teak-dev-r2-events", [
      { key: DEV_PENDING, kind: "pending-upload-check", uploadedAt: NOW },
    ]);
    await handleR2EventsBatch(batch, env, NOW + 25 * HOUR_MS);
    expect(outcomes()).toEqual(["ack"]);
    expect(bucket.objects.has(DEV_PENDING)).toBe(true);
  });

  test("acknowledges objects outside the pending namespace without touching them", async () => {
    const { bucket, env, events } = setup();
    const cardFile = "users/u1/cards/card-1/file/photo.jpg";
    bucket.objects.set(cardFile, { bytes: new Uint8Array([1]) });
    const { batch, outcomes } = createFakeBatch("teak-r2-events", [
      created(cardFile, NOW - 2 * PENDING_UPLOAD_STALE_AFTER_MS),
      created(PENDING, NOW - 2 * PENDING_UPLOAD_STALE_AFTER_MS, "DeleteObject"),
      created("exports/abc/export.zip", NOW),
      {
        key: "users/u1/cards/upload-pending-v2/../../x",
        kind: "pending-upload-check",
        uploadedAt: 0,
      },
      "not an event",
    ]);
    await handleR2EventsBatch(batch, env, NOW);
    expect(outcomes()).toEqual(["ack", "ack", "ack", "ack", "ack"]);
    expect(bucket.objects.has(cardFile)).toBe(true);
    expect(events.sent).toEqual([]);
  });

  test("retries the uploads it could not re-queue", async () => {
    const bucket = new FakeBucket();
    const events = createFakeQueue({ failSend: true });
    const { batch, settled } = createFakeBatch("teak-r2-events", [
      created(PENDING, NOW),
    ]);
    await handleR2EventsBatch(
      batch,
      { BUCKET: bucket as unknown as R2Bucket, R2_EVENTS: events.queue },
      NOW
    );
    expect(settled[0]).toMatchObject({
      outcome: "retry",
      retryDelaySeconds: 60,
    });
  });
});

describe("weekly pending upload sweep", () => {
  const sweepEnv = (bucket: FakeBucket) =>
    ({
      BUCKET: bucket,
      FILES_SIGNING_SECRET: "secret",
    }) as unknown as BackgroundEnv;

  test("walks both user prefixes to the end", async () => {
    const bucket = new FakeBucket();
    for (let index = 0; index < 10_050; index += 1) {
      bucket.objects.set(
        `users/u1/cards/upload-pending-v2/file/${String(index).padStart(5, "0")}`,
        { bytes: new Uint8Array([1]) }
      );
    }
    bucket.objects.set(DEV_PENDING, { bytes: new Uint8Array([1]) });
    const fresh = "users/u2/cards/upload-pending-v2/file/new";
    bucket.objects.set(fresh, {
      bytes: new Uint8Array([1]),
      uploadedAt: Date.now(),
    });

    expect(await sweepStalePendingUploads(sweepEnv(bucket))).toEqual({
      complete: true,
      deleted: 10_051,
    });
    expect([...bucket.objects.keys()]).toEqual([fresh]);
  });

  test("stops when its time is up", async () => {
    const bucket = new FakeBucket();
    bucket.objects.set(PENDING, { bytes: new Uint8Array([1]) });
    let time = 0;
    const summary = await sweepStalePendingUploads(sweepEnv(bucket), {
      budgetMs: 10,
      clock: () => {
        time += 10;
        return time;
      },
    });
    expect(summary).toEqual({ complete: false, deleted: 0 });
    expect(bucket.objects.has(PENDING)).toBe(true);
  });
});
