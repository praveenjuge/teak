/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { cardStorageObjectKeys } from "./storage/r2";

const modules = import.meta.glob("./**/*.ts");

const insertCard = (
  t: ReturnType<typeof convexTest>,
  type: "audio" | "image" | "video",
  fileMetadata: Record<string, unknown>
) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "media-facts",
      type,
      content: "",
      fileKey: `users/media-facts/cards/c/file/source.${type}`,
      fileMetadata,
      createdAt: 1,
      updatedAt: 1,
    })
  );

test("media facts fill a video's missing duration and size without overwriting known values", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "video", {
    fileName: "clip.mp4",
    width: 1920,
  });

  await t.mutation(
    internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
    { cardId, duration: 12.5, height: 1080, width: 640 }
  );

  const card = await t.run((ctx) => ctx.db.get(cardId));
  expect(card?.fileMetadata).toEqual({
    duration: 12.5,
    fileName: "clip.mp4",
    height: 1080,
    width: 1920,
  });
});

test("media facts leave a card untouched when nothing is missing", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "audio", { duration: 3 });

  await t.mutation(
    internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
    { cardId, duration: 99 }
  );

  const card = await t.run((ctx) => ctx.db.get(cardId));
  expect(card?.fileMetadata).toEqual({ duration: 3 });
  expect(card?.updatedAt).toBe(1);
});

test("image analysis stores EXIF camera facts beside the dimensions", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "image", { fileName: "photo.jpg" });

  await t.mutation(
    internal.workflows.steps.renderables.mutations.updateCardFileMetadata,
    {
      cardId,
      exif: {
        fNumber: 2.8,
        make: "Teak Camera Co",
        takenAt: Date.parse("2026-05-17T09:00:05Z"),
      },
      height: 30,
      width: 40,
    }
  );

  const card = await t.run((ctx) => ctx.db.get(cardId));
  expect(card?.fileMetadata).toEqual({
    exif: {
      fNumber: 2.8,
      make: "Teak Camera Co",
      takenAt: Date.parse("2026-05-17T09:00:05Z"),
    },
    fileName: "photo.jpg",
    height: 30,
    width: 40,
  });
});

const waveform = {
  detail: Array.from({ length: 200 }, (_, index) => index % 101),
  grid: Array.from({ length: 45 }, (_, index) => index),
};

test("audio facts store the duration and waveform together", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "audio", { fileName: "memo.ogg" });

  await t.mutation(
    internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
    { cardId, duration: 12.5, waveform }
  );

  const card = await t.run((ctx) => ctx.db.get(cardId));
  expect(card?.fileMetadata).toEqual({
    duration: 12.5,
    fileName: "memo.ogg",
    waveform,
  });
});

test.each([
  ["a short grid", { ...waveform, grid: waveform.grid.slice(1) }],
  ["a short detail", { ...waveform, detail: waveform.detail.slice(1) }],
  ["a bar over 100", { ...waveform, grid: [...waveform.grid.slice(1), 101] }],
  ["a fractional bar", { ...waveform, grid: [...waveform.grid.slice(1), 0.5] }],
])("audio facts refuse a waveform with %s", async (_name, invalid) => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "audio", {});

  await expect(
    t.mutation(
      internal.workflows.steps.renderables.mutations.updateCardMediaFacts,
      { cardId, waveform: invalid }
    )
  ).rejects.toThrow("invalid_waveform");
});

test("a video thumbnail records its scrub sprite and duration in one patch", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "video", { fileName: "clip.webm" });
  const scrub = { frameHeight: 180, frameWidth: 320, frames: 10 };

  await t.mutation(
    internal.workflows.steps.renderables.mutations.updateCardThumbnail,
    {
      cardId,
      duration: 61.5,
      originalHeight: 1080,
      originalWidth: 1920,
      scrub,
      scrubKey: "users/media-facts/cards/c/scrub/strip.jpg",
      thumbnailKey: "users/media-facts/cards/c/thumbnail/frame.jpg",
    }
  );

  const card = await t.run((ctx) => ctx.db.get(cardId));
  expect(card).toMatchObject({
    fileMetadata: {
      duration: 61.5,
      fileName: "clip.webm",
      height: 1080,
      scrub,
      width: 1920,
    },
    scrubKey: "users/media-facts/cards/c/scrub/strip.jpg",
    thumbnailKey: "users/media-facts/cards/c/thumbnail/frame.jpg",
  });
});

test("a video thumbnail refuses a scrub key without its size", async () => {
  const t = convexTest(schema, modules);
  const cardId = await insertCard(t, "video", {});

  await expect(
    t.mutation(
      internal.workflows.steps.renderables.mutations.updateCardThumbnail,
      {
        cardId,
        scrubKey: "users/media-facts/cards/c/scrub/strip.jpg",
        thumbnailKey: "users/media-facts/cards/c/thumbnail/frame.jpg",
      }
    )
  ).rejects.toThrow("scrub_key_and_size_go_together");
});

test("the orphan sweep keeps a card's scrub sprite", async () => {
  const t = convexTest(schema, modules);
  const scrubKey = "users/media-facts/cards/c/scrub/strip.jpg";
  const cardId = await insertCard(t, "video", {});
  await t.run((ctx) => ctx.db.patch(cardId, { scrubKey }));

  const page = await t.query(
    internal.workflows.orphanSweepQueries.pageSweepCards,
    { numItems: 10 }
  );

  expect(cardStorageObjectKeys(page.cards[0] ?? {})).toContain(scrubKey);
});
