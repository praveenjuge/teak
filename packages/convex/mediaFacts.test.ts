/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

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
        latitude: 12.971_567,
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
      latitude: 12.971_567,
      make: "Teak Camera Co",
      takenAt: Date.parse("2026-05-17T09:00:05Z"),
    },
    fileName: "photo.jpg",
    height: 30,
    width: 40,
  });
});
