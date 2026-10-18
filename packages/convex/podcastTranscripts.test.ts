/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { cardStorageObjectKeys } from "./storage/cardObjectKeys";
import { buildR2UserPrefix } from "./storage/r2";

// What the Files Worker's podcast step asks of Convex
// (workflows/steps/podcast/mutations.ts): a transcription slot per owner,
// and the episode audio listed on the card while it is stored.

const modules = import.meta.glob("./**/*.ts");

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  return t;
};

test("an owner gets 20 transcriptions an hour; another owner is unaffected", async () => {
  const t = setup();
  const take = (userId: string) =>
    t.mutation(
      internal.workflows.steps.podcast.mutations.takePodcastTranscriptSlot,
      { userId }
    );

  const granted: boolean[] = [];
  for (let i = 0; i < 21; i++) {
    granted.push(await take("owner"));
  }

  expect(granted.slice(0, 20).every(Boolean)).toBe(true);
  expect(granted[20]).toBe(false);
  expect(await take("someone-else")).toBe(true);
});

test("the episode audio is the card's while stored, and forgotten after", async () => {
  const t = setup();
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      content: "https://podcast.example.com/episodes/42",
      createdAt: 1,
      type: "link",
      updatedAt: 1,
      url: "https://podcast.example.com/episodes/42",
      userId: "owner",
      workflowArtifactKeys: ["users/owner/raw/kept"],
    })
  );
  const key = `${buildR2UserPrefix("owner")}/${cardId}/podcast-audio/abc-episode`;
  const track = (stored: boolean, trackedKey = key) =>
    t.mutation(internal.workflows.steps.podcast.mutations.trackPodcastAudio, {
      cardId,
      key: trackedKey,
      stored,
    });
  const card = () => t.run((ctx) => ctx.db.get("cards", cardId));

  expect(await track(true)).toBe(true);
  expect(await track(true)).toBe(true);
  const stored = await card();
  expect(stored?.workflowArtifactKeys).toEqual(["users/owner/raw/kept", key]);
  // Deleting the card deletes everything it lists, the audio included.
  expect(cardStorageObjectKeys(stored ?? {})).toContain(key);

  expect(await track(false)).toBe(true);
  expect((await card())?.workflowArtifactKeys).toEqual([
    "users/owner/raw/kept",
  ]);
});

test("a key outside the owner's storage is never listed on the card", async () => {
  const t = setup();
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      content: "x",
      createdAt: 1,
      type: "link",
      updatedAt: 1,
      userId: "owner",
    })
  );

  for (const key of [
    `${buildR2UserPrefix("stranger")}/${cardId}/podcast-audio/episode`,
    `${buildR2UserPrefix("owner")}-evil/episode`,
    "exports/owner/episode",
  ]) {
    expect(
      await t.mutation(
        internal.workflows.steps.podcast.mutations.trackPodcastAudio,
        { cardId, key, stored: true }
      )
    ).toBe(false);
  }
  expect(
    (await t.run((ctx) => ctx.db.get("cards", cardId)))?.workflowArtifactKeys
  ).toBeUndefined();
});

test("a card that is gone lists nothing", async () => {
  const t = setup();
  const cardId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("cards", {
      content: "x",
      createdAt: 1,
      type: "link",
      updatedAt: 1,
      userId: "owner",
    });
    await ctx.db.delete("cards", id);
    return id;
  });

  expect(
    await t.mutation(
      internal.workflows.steps.podcast.mutations.trackPodcastAudio,
      {
        cardId,
        key: `${buildR2UserPrefix("owner")}/x/podcast-audio/episode`,
        stored: true,
      }
    )
  ).toBe(false);
});
