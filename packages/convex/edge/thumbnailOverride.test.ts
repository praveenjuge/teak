import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { FILES_OP_PATH } from "@teak/files-protocol";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "../__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import schema from "../schema";
import { FREE_TIER_LIMIT } from "../shared/constants";
import { THUMBNAIL_UNDO_WINDOW_MS } from "../shared/thumbnails";
import { buildR2ObjectKey } from "../storage/r2";

const modules = import.meta.glob("../**/*.ts");

interface WorkerCall {
  op: string;
  params: Record<string, any>;
}

interface Image {
  decodedFormat: string;
  height: number | null;
  size: number;
  width: number | null;
}

const stubWorker = () => {
  const state: {
    calls: WorkerCall[];
    image: Image;
    onFinalize?: () => Promise<void>;
    refuse?: { code: string; status: number };
  } = {
    calls: [],
    image: {
      decodedFormat: "image/jpeg",
      height: 630,
      size: 2048,
      width: 1200,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        url.origin !== "https://files.test" ||
        url.pathname !== FILES_OP_PATH
      ) {
        throw new Error(`unexpected_fetch:${url}`);
      }
      const call = JSON.parse(String(init?.body)) as WorkerCall;
      state.calls.push(call);
      if (call.op === "finalize-image-upload") {
        await state.onFinalize?.();
        if (state.refuse) {
          return Response.json(
            {
              ok: false,
              error: {
                code: state.refuse.code,
                message: "refused",
                requestId: "r",
                retryable: false,
              },
            },
            { status: state.refuse.status }
          );
        }
        const { decodedFormat, height, size, width } = state.image;
        return Response.json({
          ok: true,
          version: 1,
          requestId: "r",
          data: {
            decodedFormat,
            destinationKey: call.params.destinationKey,
            height,
            sourceEtag: '"e"',
            storedEtag: '"e"',
            storedFileSize: size,
            storedMimeType: decodedFormat,
            width,
          },
        });
      }
      const deleted =
        call.op === "delete-objects" ? call.params.keys.length : true;
      return Response.json({
        ok: true,
        version: 1,
        requestId: "r",
        data: { deleted },
      });
    })
  );
  return state;
};

const deletedKeys = (calls: WorkerCall[]) =>
  calls.flatMap((call) => {
    if (call.op === "delete-objects") {
      return call.params.keys as string[];
    }
    return call.op === "delete-object" ? [call.params.key as string] : [];
  });

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError
      ? (error.data as { code: string }).code
      : String(error);
  }
  throw new Error("expected the call to fail");
};

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  const asUser = async (teakUserId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: await seedWorkosOwner(t, teakUserId),
      sid: `session_${teakUserId}`,
      email_verified: true,
      external_id: teakUserId,
    });
  const owner = await asUser("owner");
  const stranger = await asUser("stranger");
  const worker = stubWorker();

  const insertCard = (seed: Partial<Doc<"cards">> = {}) =>
    t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "link",
        content: "https://example.com/article",
        url: "https://example.com/article",
        metadata: {
          linkPreview: {
            status: "success",
            title: "An article",
            imageStorageKey: "users/owner/cards/scraped/og.jpg",
            imageWidth: 1200,
            imageHeight: 630,
          },
        },
        createdAt: 1000,
        updatedAt: 1000,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));

  const replace = async (
    cardId: Id<"cards">,
    image: Partial<Image> = {},
    as = owner
  ) => {
    worker.image = { ...worker.image, ...image };
    const upload = await as.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId, fileSize: 2048, mimeType: "image/jpeg" }
    );
    return as.action(api.card.thumbnailOverride.setLinkThumbnail, {
      cardId,
      fileKey: upload.fileKey,
    });
  };

  const undo = (cardId: Id<"cards">, changeId: string) =>
    owner.mutation(api.card.thumbnailOverride.undoThumbnailChange, {
      cardId,
      changeId,
    });

  const runFor = async (ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      vi.advanceTimersByTime(500);
      await t.finishInProgressScheduledFunctions();
    }
  };
  const runAll = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const queuedDeletes = () => queuedObjectDeletions(t);

  return {
    t,
    owner,
    stranger,
    worker,
    insertCard,
    card,
    replace,
    undo,
    runFor,
    runAll,
    queuedDeletes,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "thumbnail-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("thumbnail upload URL", () => {
  test("signs a PUT into the swept pending namespace, named for the card", async () => {
    const { owner, insertCard } = await setup();
    const cardId = await insertCard();
    const upload = await owner.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId, fileSize: 5000, mimeType: "image/png" }
    );
    expect(upload.fileKey).toMatch(
      /\/cards\/upload-pending-v2\/thumbnail-override-pending\/[0-9a-f-]{36}-card-/
    );
    expect(upload.fileKey.endsWith(`-card-${cardId}`)).toBe(true);
    const url = new URL(upload.uploadUrl);
    expect(url.searchParams.get("ct")).toBe("image/png");
    expect(url.searchParams.get("sz")).toBe("5000");
    expect(upload.maxFileSize).toBe(20 * 1024 * 1024);
  });

  test("works for an account at the free plan's card limit", async () => {
    const { t, owner, insertCard } = await setup();
    const cardId = await insertCard();
    await t.run((ctx) =>
      ctx.db.insert("userCardUsage", {
        userId: "owner",
        activeCardCount: FREE_TIER_LIMIT,
        isSaturated: true,
        updatedAt: Date.now(),
      })
    );
    const upload = await owner.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId, fileSize: 5000, mimeType: "image/webp" }
    );
    expect(upload.method).toBe("PUT");
  });

  test.each([
    ["image/svg+xml", 100, "UNSUPPORTED_TYPE"],
    ["image/heic", 100, "UNSUPPORTED_TYPE"],
    ["text/plain", 100, "UNSUPPORTED_TYPE"],
    ["image/jpeg", 20 * 1024 * 1024 + 1, "FILE_TOO_LARGE"],
    ["image/jpeg", 0, "INVALID_INPUT"],
  ])("refuses %s of %d bytes with %s", async (mimeType, fileSize, code) => {
    const { owner, insertCard } = await setup();
    const cardId = await insertCard();
    expect(
      await codeOf(
        owner.mutation(api.card.thumbnailOverride.createThumbnailUploadUrl, {
          cardId,
          fileSize,
          mimeType,
        })
      )
    ).toBe(code);
  });

  test("refuses another user's card, a card in Trash and a non-link card", async () => {
    const { owner, stranger, insertCard } = await setup();
    const link = await insertCard();
    const trashed = await insertCard({ isDeleted: true, deletedAt: 1 });
    const note = await insertCard({ type: "text", url: undefined });
    const request = (as: typeof owner, cardId: Id<"cards">) =>
      codeOf(
        as.mutation(api.card.thumbnailOverride.createThumbnailUploadUrl, {
          cardId,
          fileSize: 10,
          mimeType: "image/jpeg",
        })
      );
    expect(await request(stranger, link)).toBe("NOT_FOUND");
    expect(await request(owner, trashed)).toBe("CONFLICT");
    expect(await request(owner, note)).toBe("TYPE_MISMATCH");
  });
});

describe("replacing a link's image", () => {
  test("stores the worker's trusted dimensions and shows the new image", async () => {
    const { owner, insertCard, card, replace, worker } = await setup();
    const cardId = await insertCard();
    const result = await replace(cardId, { width: 600, height: 900 });

    const stored = await card(cardId);
    expect(stored?.thumbnailOverride).toMatchObject({
      width: 600,
      height: 900,
    });
    expect(stored?.thumbnailOverride?.storageKey).toContain(
      `/cards/${cardId}/thumbnail-override/`
    );
    expect(stored?.thumbnailChangeId).toBe(result.changeId);
    const finalize = worker.calls.find(
      (call) => call.op === "finalize-image-upload"
    );
    expect(finalize?.params.destinationKey).toBe(
      stored?.thumbnailOverride?.storageKey
    );

    const shown = await owner.query(api.cards.getCardByUrlId, { id: cardId });
    expect(shown?.hasThumbnailOverride).toBe(true);
    expect(shown?.linkPreviewImageUrl).toContain(
      encodeURIComponent(stored?.thumbnailOverride?.storageKey ?? "")
    );
  });

  test("refuses a pending key for another card, role or user before the worker runs", async () => {
    const { owner, insertCard, card, worker } = await setup();
    const cardId = await insertCard();
    const other = await insertCard();
    const forOther = await owner.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId: other, fileSize: 10, mimeType: "image/jpeg" }
    );
    const keys = [
      forOther.fileKey,
      buildR2ObjectKey({
        userId: "owner",
        cardId: "upload-pending-v2",
        role: "file",
        fileName: `card-${cardId}`,
      }),
      buildR2ObjectKey({
        userId: "stranger",
        cardId: "upload-pending-v2",
        role: "thumbnail-override-pending",
        fileName: `card-${cardId}`,
      }),
    ];
    for (const fileKey of keys) {
      expect(
        await codeOf(
          owner.action(api.card.thumbnailOverride.setLinkThumbnail, {
            cardId,
            fileKey,
          })
        )
      ).toBe("NOT_FOUND");
    }
    expect(worker.calls).toEqual([]);
    expect((await card(cardId))?.thumbnailOverride).toBeUndefined();
  });

  test.each([
    [{ decodedFormat: "image/svg+xml" }, "UNSUPPORTED_TYPE"],
    [{ decodedFormat: "image/heic" }, "UNSUPPORTED_TYPE"],
    [{ size: 20 * 1024 * 1024 + 1 }, "FILE_TOO_LARGE"],
    [{ width: null }, "INVALID_INPUT"],
  ])("deletes a finalized %o image it refuses (%s)", async (image, code) => {
    const { owner, insertCard, card, worker } = await setup();
    const cardId = await insertCard();
    worker.image = { ...worker.image, ...image };
    const upload = await owner.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId, fileSize: 10, mimeType: "image/jpeg" }
    );
    expect(
      await codeOf(
        owner.action(api.card.thumbnailOverride.setLinkThumbnail, {
          cardId,
          fileKey: upload.fileKey,
        })
      )
    ).toBe(code);
    const finalize = worker.calls.find(
      (call) => call.op === "finalize-image-upload"
    );
    expect(deletedKeys(worker.calls)).toEqual([
      finalize?.params.destinationKey,
    ]);
    expect((await card(cardId))?.thumbnailOverride).toBeUndefined();
  });

  test("names an undecodable or missing upload", async () => {
    const { owner, insertCard, worker } = await setup();
    const cardId = await insertCard();
    const apply = async () => {
      const upload = await owner.mutation(
        api.card.thumbnailOverride.createThumbnailUploadUrl,
        { cardId, fileSize: 10, mimeType: "image/png" }
      );
      return codeOf(
        owner.action(api.card.thumbnailOverride.setLinkThumbnail, {
          cardId,
          fileKey: upload.fileKey,
        })
      );
    };
    worker.refuse = { code: "UNSUPPORTED", status: 415 };
    expect(await apply()).toBe("INVALID_INPUT");
    worker.refuse = { code: "NOT_FOUND", status: 404 };
    expect(await apply()).toBe("NOT_FOUND");
  });

  test("deletes the finalized image when the card can't take it any more", async () => {
    const { t, insertCard, card, replace, worker } = await setup();
    const cardId = await insertCard();
    worker.onFinalize = async () => {
      await t.run((ctx) =>
        ctx.db.patch("cards", cardId, { isDeleted: true, deletedAt: 1 })
      );
    };
    expect(await codeOf(replace(cardId))).toBe("CONFLICT");
    const finalize = worker.calls.find(
      (call) => call.op === "finalize-image-upload"
    );
    expect(deletedKeys(worker.calls)).toEqual([
      finalize?.params.destinationKey,
    ]);
    expect((await card(cardId))?.thumbnailOverride).toBeUndefined();
  });

  test("allows 20 changes a minute", async () => {
    const { t, owner, insertCard, replace, worker } = await setup();
    const cardId = await insertCard();
    const early = await owner.mutation(
      api.card.thumbnailOverride.createThumbnailUploadUrl,
      { cardId, fileSize: 10, mimeType: "image/gif" }
    );
    for (let index = 0; index < 20; index += 1) {
      await t.mutation(internal.card.thumbnailOverride.reserveThumbnailChange, {
        cardId,
        userId: "owner",
      });
    }
    expect(
      await codeOf(
        owner.action(api.card.thumbnailOverride.setLinkThumbnail, {
          cardId,
          fileKey: early.fileKey,
        })
      )
    ).toBe("RATE_LIMITED");
    expect(await codeOf(replace(cardId))).toBe("RATE_LIMITED");
    expect(worker.calls).toEqual([]);
    vi.advanceTimersByTime(60_000);
    await expect(replace(cardId)).resolves.toMatchObject({
      changeId: expect.any(String),
    });
  });

  test("Refresh details keeps the chosen image", async () => {
    const { t, insertCard, card, replace } = await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const chosen = (await card(cardId))?.thumbnailOverride;
    await t.mutation(internal.linkMetadata.updateCardMetadata, {
      cardId,
      status: "completed",
      linkPreview: {
        status: "success",
        title: "Refreshed",
        imageStorageKey: "users/owner/cards/scraped/new-og.jpg",
      },
    });
    const refreshed = await card(cardId);
    expect(refreshed?.metadataTitle).toBe("Refreshed");
    expect(refreshed?.thumbnailOverride).toEqual(chosen);
  });
});

describe("the undo window", () => {
  test("keeps the replaced image until the window closes, then deletes it", async () => {
    const { insertCard, card, replace, queuedDeletes, runFor, runAll } =
      await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const first = (await card(cardId))?.thumbnailOverride?.storageKey;
    await replace(cardId);
    const second = (await card(cardId))?.thumbnailOverride?.storageKey;

    await runFor(THUMBNAIL_UNDO_WINDOW_MS - 5000);
    expect(await queuedDeletes()).not.toContain(first);
    expect(
      (await card(cardId))?.previousThumbnailOverride?.override
    ).toMatchObject({ storageKey: first });

    await runAll();
    expect(await queuedDeletes()).toContain(first);
    expect(await queuedDeletes()).not.toContain(second);
  });

  test("undo brings back the replaced image with its own dimensions", async () => {
    const { insertCard, card, replace, undo, queuedDeletes, runAll } =
      await setup();
    const cardId = await insertCard();
    await replace(cardId, { width: 600, height: 900 });
    const portrait = (await card(cardId))?.thumbnailOverride;
    const { changeId } = await replace(cardId, { width: 1600, height: 900 });
    const landscape = (await card(cardId))?.thumbnailOverride?.storageKey;

    expect(await undo(cardId, changeId)).toEqual({ status: "restored" });
    const restored = await card(cardId);
    expect(restored?.thumbnailOverride).toEqual(portrait);
    expect(restored?.previousThumbnailOverride).toBeUndefined();

    await runAll();
    expect(await queuedDeletes()).toContain(landscape);
    expect(await queuedDeletes()).not.toContain(portrait?.storageKey);
    expect((await card(cardId))?.thumbnailOverride).toEqual(portrait);
  });

  test("undoing a first replace goes back to the original image", async () => {
    const { owner, insertCard, card, replace, undo, queuedDeletes, runAll } =
      await setup();
    const cardId = await insertCard();
    const { changeId } = await replace(cardId);
    const chosen = (await card(cardId))?.thumbnailOverride?.storageKey;

    expect(await undo(cardId, changeId)).toEqual({ status: "restored" });
    expect((await card(cardId))?.thumbnailOverride).toBeUndefined();
    const shown = await owner.query(api.cards.getCardByUrlId, { id: cardId });
    expect(shown?.hasThumbnailOverride).toBeUndefined();

    await runAll();
    expect(await queuedDeletes()).toContain(chosen);
  });

  test("a stale undo after A→B→C changes nothing", async () => {
    const { insertCard, card, replace, undo, queuedDeletes, runAll } =
      await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const toB = await replace(cardId);
    const b = (await card(cardId))?.thumbnailOverride?.storageKey;
    await replace(cardId);
    const c = (await card(cardId))?.thumbnailOverride;

    expect(await undo(cardId, toB.changeId)).toEqual({
      status: "expired",
      code: "UNDO_EXPIRED",
    });
    expect((await card(cardId))?.thumbnailOverride).toEqual(c);

    await runAll();
    const deleted = await queuedDeletes();
    expect(deleted).toContain(b);
    expect(deleted).not.toContain(c?.storageKey);
    expect(
      deleted.filter((key) => key.includes("/thumbnail-override/"))
    ).toHaveLength(2);
  });

  test("an undo after the window has closed changes nothing", async () => {
    const { insertCard, card, replace, undo } = await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const { changeId } = await replace(cardId);
    const current = (await card(cardId))?.thumbnailOverride;
    vi.advanceTimersByTime(THUMBNAIL_UNDO_WINDOW_MS);
    expect(await undo(cardId, changeId)).toEqual({
      status: "expired",
      code: "UNDO_EXPIRED",
    });
    expect((await card(cardId))?.thumbnailOverride).toEqual(current);
  });

  test("the scheduled deletion never removes the card's current image", async () => {
    const { t, insertCard, card, replace, queuedDeletes, runAll } =
      await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const current = (await card(cardId))?.thumbnailOverride?.storageKey ?? "";
    await t.mutation(internal.card.thumbnailOverride.deleteReplacedThumbnail, {
      cardId,
      storageKey: current,
    });
    await runAll();
    expect(await queuedDeletes()).not.toContain(current);
  });
});

describe("resetting a link's image", () => {
  test("goes back to the original, keeps the chosen image for undo, then deletes it", async () => {
    const { owner, insertCard, card, replace, undo, queuedDeletes, runAll } =
      await setup();
    const cardId = await insertCard();
    await replace(cardId);
    const chosen = (await card(cardId))?.thumbnailOverride;

    const reset = await owner.mutation(
      api.card.thumbnailOverride.resetLinkThumbnail,
      { cardId }
    );
    expect((await card(cardId))?.thumbnailOverride).toBeUndefined();
    expect(await undo(cardId, reset.changeId ?? "")).toEqual({
      status: "restored",
    });
    expect((await card(cardId))?.thumbnailOverride).toEqual(chosen);

    const again = await owner.mutation(
      api.card.thumbnailOverride.resetLinkThumbnail,
      { cardId }
    );
    expect(again.changeId).toEqual(expect.any(String));
    await runAll();
    expect(await queuedDeletes()).toContain(chosen?.storageKey);
    expect((await card(cardId))?.previousThumbnailOverride).toBeUndefined();
  });

  test("a card on its original image is left alone", async () => {
    const { owner, insertCard, card } = await setup();
    const cardId = await insertCard();
    const before = await card(cardId);
    expect(
      await owner.mutation(api.card.thumbnailOverride.resetLinkThumbnail, {
        cardId,
      })
    ).toEqual({ changeId: null, undoUntil: null });
    expect(await card(cardId)).toEqual(before);
  });
});

test("deleting a card forever deletes its chosen image and the one kept for undo", async () => {
  const { t, insertCard, card, replace, queuedDeletes, runAll } = await setup();
  const cardId = await insertCard();
  await replace(cardId);
  const kept = (await card(cardId))?.thumbnailOverride?.storageKey;
  await replace(cardId);
  const current = (await card(cardId))?.thumbnailOverride?.storageKey;
  await t.run((ctx) =>
    ctx.db.patch("cards", cardId, { isDeleted: true, deletedAt: 1 })
  );
  await t.mutation(internal.card.deleteCard.permanentDeleteCardForUser, {
    cardId,
    userId: "owner",
  });
  await runAll();
  expect(await card(cardId)).toBeNull();
  expect(await queuedDeletes()).toEqual(
    expect.arrayContaining([kept, current])
  );
});
