import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import {
  ONBOARDING_BACKSTOP_MS,
  ONBOARDING_CARDS,
  ONBOARDING_FOLDER,
  ONBOARDING_SMART_FOLDER,
  ONBOARDING_TAG,
  startVaultSetup,
} from "../card/defaultCards";
import { readCardTranscript } from "../card/textContents";
import schema from "../schema";
import { buildR2ObjectKey } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");
const USER_ID = "teak_onboarding";
const UPLOAD_CARDS = ONBOARDING_CARDS.filter((card) => card.uploads);

const setup = () => {
  const t = convexTest(schema, modules);
  return t;
};
type Backend = ReturnType<typeof setup>;

// Each card with its transcript, which lives in `cardTextContents`.
const cardsOf = (t: Backend) =>
  t.run(async (ctx) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_saved", (q) => q.eq("userId", USER_ID))
      .take(50);
    return await Promise.all(
      cards.map(async (card) => ({
        ...card,
        aiTranscript: await readCardTranscript(ctx, card),
      }))
    );
  });

const foldersOf = (t: Backend) =>
  t.run((ctx) =>
    ctx.db
      .query("folders")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", USER_ID))
      .take(10)
  );

const scheduled = async (t: Backend, name: string) =>
  (
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(100))
  ).filter((job) => job.name === name);

const createDefaults = (t: Backend) =>
  t.mutation(internal.card.defaultCards.createDefaultCardsForUser, {
    userId: USER_ID,
  });

const signedUp = () => {
  const t = setup();
  return t.run((ctx) => startVaultSetup(ctx, USER_ID)).then(() => t);
};

const keyFor = (slot: string, name: string) =>
  buildR2ObjectKey({
    userId: USER_ID,
    cardId: "stored",
    role: slot,
    fileName: name,
  });

const storedEverything = () =>
  UPLOAD_CARDS.map((card) => ({
    onboarding: card.onboarding,
    fileSize: 1234,
    keys: Object.fromEntries(
      (card.uploads ?? []).map((upload) => [
        upload.slot,
        keyFor(upload.slot, upload.name),
      ])
    ),
  }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.example.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "onboarding-test-secret");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface WorkerCall {
  op: string;
  params: {
    cards?: {
      files: { contentType: string; key: string; source: string }[];
      onboarding: string;
    }[];
  };
}

/** Answers Core Worker ops the way a Worker with the assets binding does. */
const stubCoreWorker = () => {
  const calls: WorkerCall[] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    const call = JSON.parse(String(init.body)) as WorkerCall;
    calls.push(call);
    const cards = (call.params.cards ?? []).map((card) => ({
      onboarding: card.onboarding,
      stored: true,
      files: card.files.map((file) => ({ key: file.key, size: 4321 })),
    }));
    return Promise.resolve(Response.json({ ok: true, data: { cards } }));
  });
  return calls;
};

describe("getting-started cards", () => {
  test("a new account's files are stored first; nothing is inserted until then", async () => {
    const t = setup();

    expect(await createDefaults(t)).toEqual({ created: true, deferred: true });

    const [job] = await scheduled(t, "card/onboardingFiles:addOnboardingCards");
    expect(job?.args[0]).toMatchObject({ userId: USER_ID });
    const [backstop] = await scheduled(
      t,
      "card/defaultCards:insertOnboardingCards"
    );
    expect(backstop?.args[0]).toEqual({
      userId: USER_ID,
      createdAt: (job!.args[0] as { createdAt: number }).createdAt,
      stored: [],
    });
    expect(backstop!.scheduledTime - job!.scheduledTime).toBeGreaterThanOrEqual(
      ONBOARDING_BACKSTOP_MS
    );
    expect(await cardsOf(t)).toHaveLength(0);
    expect(await foldersOf(t)).toHaveLength(0);
  });

  test("the sign-up job has the Core Worker store the files, and the cards carry them", async () => {
    const calls = stubCoreWorker();
    const t = setup();
    await createDefaults(t);
    const [job] = await scheduled(t, "card/onboardingFiles:addOnboardingCards");

    await t.action(
      internal.card.onboardingFiles.addOnboardingCards,
      job!.args[0] as { createdAt: number; userId: string }
    );

    expect(calls.map((call) => call.op)).toEqual(["store-onboarding-files"]);
    const sent = new Map(
      (calls[0]?.params.cards ?? []).map((card) => [
        card.onboarding,
        card.files.map((file) => file.key),
      ])
    );
    const cards = await cardsOf(t);
    expect(cards).toHaveLength(ONBOARDING_CARDS.length);
    const byType = (type: string) => cards.find((card) => card.type === type);
    expect(byType("image")).toMatchObject({
      fileKey: sent.get("image")?.[0],
      fileMetadata: { fileName: "Coral lily.webp", fileSize: 4321 },
    });
    expect(byType("video")).toMatchObject({
      fileKey: sent.get("video")?.[0],
      thumbnailKey: sent.get("video")?.[1],
      scrubKey: sent.get("video")?.[2],
    });
    expect(byType("document")).toMatchObject({
      fileKey: sent.get("document")?.[0],
      thumbnailKey: sent.get("document")?.[1],
    });
    expect(byType("link")?.metadata?.linkPreview).toMatchObject({
      imageStorageKey: sent.get("link")?.[0],
      screenshotStorageKey: sent.get("link")?.[1],
    });
    expect(byType("link")?.metadataStatus).toBe("completed");
    const owned = await t.run((ctx) =>
      ctx.db
        .query("accountStorageObjects")
        .withIndex("by_userId_and_key", (q) => q.eq("userId", USER_ID))
        .take(50)
    );
    expect(owned.map((row) => row.key).sort()).toEqual(
      [...sent.values()].flat().sort()
    );
  });

  test("every card arrives at once, finished, in Start here, newest first", async () => {
    const t = await signedUp();
    const stored = storedEverything();
    const keysOf = (onboarding: string) =>
      stored.find((entry) => entry.onboarding === onboarding)?.keys ?? {};

    expect(
      await t.mutation(internal.card.defaultCards.insertOnboardingCards, {
        userId: USER_ID,
        createdAt: 10_000_000,
        stored,
      })
    ).toBe(ONBOARDING_CARDS.length);

    const folders = await foldersOf(t);
    const startHere = folders.find((f) => f.name === ONBOARDING_FOLDER.name);
    expect(startHere).toMatchObject({ kind: "manual", color: "orange" });
    expect(
      folders.find((f) => f.name === ONBOARDING_SMART_FOLDER.name)
    ).toMatchObject({ kind: "smart", query: "type:image type:palette" });

    const cards = await cardsOf(t);
    expect(cards.map((card) => card.onboarding).sort()).toEqual(
      ONBOARDING_CARDS.map((card) => card.onboarding).sort()
    );
    for (const card of cards) {
      expect(card.tags).toEqual([ONBOARDING_TAG]);
      expect(card.folderIds).toEqual([startHere?._id]);
      expect(card.metadataStatus).toBe("completed");
      expect(
        Object.values(card.processingStatus ?? {}).every(
          (stage) => stage?.status === "completed"
        )
      ).toBe(true);
    }
    const newest = [...cards].sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(newest).toMatchObject({
      onboarding: "welcome",
      createdAt: 10_000_000,
    });

    const video = cards.find((card) => card.type === "video");
    expect(video).toMatchObject({
      fileKey: keysOf("video").file,
      thumbnailKey: keysOf("video").thumbnail,
      scrubKey: keysOf("video").scrub,
      fileMetadata: { width: 1920, height: 1200, fileSize: 1234 },
    });
    const link = cards.find((card) => card.type === "link");
    expect(link?.metadata?.linkPreview).toMatchObject({
      imageStorageKey: keysOf("link").linkImage,
      screenshotStorageKey: keysOf("link").screenshot,
    });
    expect(cards.find((card) => card.type === "audio")?.aiTranscript).toContain(
      "serif"
    );
    const pdf = cards.find((card) => card.type === "document");
    expect(
      (await scheduled(t, "card/extractDocumentText:extractDocumentText")).map(
        (job) => (job.args[0] as { cardId: string }).cardId
      )
    ).toEqual([pdf?._id]);
  });

  test("without a Core Worker, the cards that need no files arrive at once", async () => {
    vi.stubEnv("FILES_BASE", "");
    const t = setup();

    expect(await createDefaults(t)).toEqual({ created: true, count: 4 });

    const cards = await cardsOf(t);
    expect(cards.map((card) => card.onboarding).sort()).toEqual(
      ["link", "palette", "quote", "welcome"].sort()
    );
    expect(cards.find((card) => card.type === "link")?.metadataStatus).toBe(
      "pending"
    );
    expect(
      await scheduled(t, "card/onboardingFiles:addOnboardingCards")
    ).toHaveLength(0);
  });

  test("the backstop gives the cards needing no files, and only once", async () => {
    const t = await signedUp();
    const insert = (stored: ReturnType<typeof storedEverything>) =>
      t.mutation(internal.card.defaultCards.insertOnboardingCards, {
        userId: USER_ID,
        createdAt: 1,
        stored,
      });

    expect(await insert([])).toBe(4);
    expect(await insert(storedEverything())).toBe(0);
    expect(await insert([])).toBe(0);

    expect((await cardsOf(t)).map((card) => card.onboarding).sort()).toEqual(
      ["link", "palette", "quote", "welcome"].sort()
    );
  });

  test("cards deleted for good before the backstop fires stay gone", async () => {
    const t = await signedUp();
    await createDefaults(t);
    await t.mutation(internal.card.defaultCards.insertOnboardingCards, {
      userId: USER_ID,
      createdAt: 1,
      stored: storedEverything(),
    });
    await t.run(async (ctx) => {
      for (const card of await ctx.db.query("cards").take(50)) {
        await ctx.db.delete("cards", card._id);
      }
    });

    const [backstop] = await scheduled(
      t,
      "card/defaultCards:insertOnboardingCards"
    );
    expect(
      await t.mutation(
        internal.card.defaultCards.insertOnboardingCards,
        backstop!.args[0] as {
          userId: string;
          createdAt: number;
          stored: [];
        }
      )
    ).toBe(0);
    expect(await cardsOf(t)).toHaveLength(0);
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

  test("refuses files stored outside the account", async () => {
    const t = await signedUp();
    const stored = storedEverything();
    stored[0]!.keys.file = buildR2ObjectKey({
      userId: "someone_else",
      cardId: "stored",
      role: "file",
      fileName: "Coral lily.webp",
    });

    await expect(
      t.mutation(internal.card.defaultCards.insertOnboardingCards, {
        userId: USER_ID,
        createdAt: 1,
        stored,
      })
    ).rejects.toThrow("does not belong");
    expect(await cardsOf(t)).toHaveLength(0);
  });

  describe("Setting up your vault", () => {
    const signedIn = async () => {
      const t = setup();
      const workosUserId = await seedWorkosOwner(t, USER_ID);
      const owner = t.withIdentity({
        issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
        subject: workosUserId,
        sid: "session_vaultsetup",
        email_verified: true,
        external_id: USER_ID,
      });
      const setupState = () =>
        owner.query(api.card.vaultSetup.getVaultSetup, {});
      return { t, setupState };
    };

    test("shows from sign-up until the cards land, in the same transaction", async () => {
      const { t, setupState } = await signedIn();
      await t.run((ctx) => startVaultSetup(ctx, USER_ID));
      expect(await setupState()).toEqual({ startedAt: expect.any(Number) });

      await createDefaults(t);
      expect(await setupState()).not.toBeNull();
      expect(await cardsOf(t)).toHaveLength(0);

      await t.mutation(internal.card.defaultCards.insertOnboardingCards, {
        userId: USER_ID,
        createdAt: 1,
        stored: storedEverything(),
      });
      expect(await setupState()).toBeNull();
      expect(await cardsOf(t)).toHaveLength(ONBOARDING_CARDS.length);
    });

    test("ends when the account already had cards, so nothing is coming", async () => {
      const { t, setupState } = await signedIn();
      await t.run(async (ctx) => {
        await startVaultSetup(ctx, USER_ID);
        await ctx.db.insert("cards", {
          userId: USER_ID,
          type: "text",
          content: "Mine",
          createdAt: 1,
          updatedAt: 1,
        });
      });

      await createDefaults(t);

      expect(await setupState()).toBeNull();
    });

    test("is null for an account that was never setting up", async () => {
      const { setupState } = await signedIn();
      expect(await setupState()).toBeNull();
    });
  });
});
