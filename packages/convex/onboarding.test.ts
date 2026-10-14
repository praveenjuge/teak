/// <reference types="vite/client" />
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  ONBOARDING_CARDS,
  ONBOARDING_FOLDER,
  ONBOARDING_SMART_FOLDER,
  ONBOARDING_TAG,
} from "./card/defaultCards";
import schema from "./schema";
import { buildR2ObjectKey } from "./storage/r2";

const modules = import.meta.glob("./**/*.ts");
const USER_ID = "teak_onboarding";
const FILE_CARDS = ONBOARDING_CARDS.filter((card) => card.file);

const setup = () => {
  const t = convexTest(schema, modules);
  workflowTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;

const cardsOf = (t: Backend) =>
  t.run((ctx) =>
    ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) => q.eq("userId", USER_ID))
      .take(50)
  );

const foldersOf = (t: Backend) =>
  t.run((ctx) =>
    ctx.db
      .query("folders")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", USER_ID))
      .take(10)
  );

const scheduledFileCards = async (t: Backend) =>
  (
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(100))
  ).filter((job) => job.name === "card/onboardingFiles:addOnboardingFileCards");

const createDefaults = (t: Backend) =>
  t.mutation(internal.card.defaultCards.createDefaultCardsForUser, {
    userId: USER_ID,
  });

// Card creation stops at the committed mutation. Hold the scheduled workflow
// runs so link processing never reaches the network or outlives the test.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.example.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "onboarding-test-secret");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("getting-started cards", () => {
  test("a new account gets a Start here folder of tagged cards, newest first", async () => {
    const t = setup();

    expect(await createDefaults(t)).toEqual({
      created: true,
      count: ONBOARDING_CARDS.length - FILE_CARDS.length,
      files: FILE_CARDS.length,
    });

    const folders = await foldersOf(t);
    const startHere = folders.find((f) => f.name === ONBOARDING_FOLDER.name);
    expect(startHere).toMatchObject({ kind: "manual", color: "orange" });
    expect(
      folders.find((f) => f.name === ONBOARDING_SMART_FOLDER.name)
    ).toMatchObject({ kind: "smart", query: "type:image type:palette" });

    const cards = await cardsOf(t);
    expect(cards.map((card) => card.onboarding).sort()).toEqual(
      ["link", "palette", "quote", "welcome"].sort()
    );
    for (const card of cards) {
      expect(card.tags).toEqual([ONBOARDING_TAG]);
      expect(card.folderIds).toEqual([startHere?._id]);
    }
    // The welcome card leads the grid, which lists the newest card first.
    const newest = [...cards].sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(newest?.onboarding).toBe("welcome");
    expect(newest?.isFavorited).toBe(true);
  });

  test("hands the image, memo, PDF, and video to the upload action in grid order", async () => {
    const t = setup();
    await createDefaults(t);
    const cards = await cardsOf(t);
    const welcome = cards.find((card) => card.onboarding === "welcome");
    const palette = cards.find((card) => card.onboarding === "palette");
    const [job] = await scheduledFileCards(t);
    const planned = job?.args[0] as {
      cards: { createdAt: number; onboarding: string }[];
      userId: string;
    };

    expect(planned.userId).toBe(USER_ID);
    expect(planned.cards.map((card) => card.onboarding)).toEqual(
      FILE_CARDS.map((card) => card.onboarding)
    );
    // The image lands between the welcome card and the palette.
    const image = planned.cards.find((card) => card.onboarding === "image");
    expect(image?.createdAt).toBeLessThan(welcome?.createdAt ?? 0);
    expect(image?.createdAt).toBeGreaterThan(palette?.createdAt ?? 0);
  });

  test("leaves out the file cards when there is no Files Worker to store them", async () => {
    vi.stubEnv("FILES_BASE", "");
    const t = setup();

    expect(await createDefaults(t)).toMatchObject({ created: true, files: 0 });
    expect(await scheduledFileCards(t)).toHaveLength(0);
  });

  test("adds nothing to an account that already has cards", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: USER_ID,
        type: "text",
        content: "Mine",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    expect(await createDefaults(t)).toEqual({
      created: false,
      reason: "cards_exist",
    });
    expect(await foldersOf(t)).toHaveLength(0);
    expect(await cardsOf(t)).toHaveLength(1);
  });

  test("an uploaded getting-started file becomes a processing card in Start here", async () => {
    const t = setup();
    await createDefaults(t);
    const startHere = (await foldersOf(t)).find(
      (f) => f.name === ONBOARDING_FOLDER.name
    );
    const fileKey = buildR2ObjectKey({
      userId: USER_ID,
      cardId: "stored",
      role: "file",
      fileName: "Teak search cheat sheet.pdf",
    });

    const cardId = await t.mutation(
      internal.card.defaultCards.insertOnboardingFileCard,
      {
        createdAt: 1234,
        fileKey,
        fileSize: 5000,
        folderId: startHere?._id,
        onboarding: "document",
        userId: USER_ID,
      }
    );

    const card = await t.run((ctx) => ctx.db.get("cards", cardId!));
    expect(card).toMatchObject({
      type: "document",
      fileKey,
      onboarding: "document",
      tags: [ONBOARDING_TAG],
      folderIds: [startHere?._id],
      createdAt: 1234,
      fileMetadata: {
        fileName: "Teak search cheat sheet.pdf",
        fileSize: 5000,
        mimeType: "application/pdf",
      },
    });
    expect(card?.processingStatus?.metadata?.status).toBe("pending");
  });

  test("refuses a getting-started file stored outside the account", async () => {
    const t = setup();

    await expect(
      t.mutation(internal.card.defaultCards.insertOnboardingFileCard, {
        createdAt: 1,
        fileKey: buildR2ObjectKey({
          userId: "someone_else",
          cardId: "stored",
          role: "file",
          fileName: "Coral flowers.webp",
        }),
        fileSize: 10,
        onboarding: "image",
        userId: USER_ID,
      })
    ).rejects.toThrow("does not belong");
    expect(await cardsOf(t)).toHaveLength(0);
  });
});
