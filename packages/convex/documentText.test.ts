/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { queuedObjectDeletions } from "./__tests__/helpers/objectDeletions.test-utils";
import { seedWorkosOwner } from "./__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteAccountDataHandler, type OwnedCardIds } from "./accountDeletion";
import { captureDeletionBatch } from "./accountDeletionBatch";
import { documentTextKey } from "./card/documentText";
import {
  FILE_TEXT_SEARCH_LIMIT,
  searchCardsByDocument,
  syncCardSearchDocumentHandler,
} from "./card/searchDocumentHelpers";
import schema from "./schema";
import { cardStorageObjectKeys } from "./storage/r2";

const modules = import.meta.glob("./**/*.ts");
const documentText = (internal as any)["card/documentText"];
const backfill = (internal as any)["migration/backfillDocumentText"];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-secret");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const PDF_TEXT = [
  "Quarterly supplier review",
  "Kestrel Freight agreed to net 30 days on every invoice.",
  "Appendix: shipping lanes",
].join("\n");

const digest = (fill: string) => fill.repeat(64);

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  workosTest.register(t);
  const ownerWorkosId = await seedWorkosOwner(t, "owner");
  const strangerWorkosId = await seedWorkosOwner(t, "stranger");
  const identity = (subject: string, externalId: string) =>
    t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject,
      sid: `session_${externalId}`,
      email_verified: true,
      external_id: externalId,
    });
  const owner = identity(ownerWorkosId, "owner");

  let createdAt = 1000;
  const insert = (seed: Partial<Doc<"cards">> = {}, userId = "owner") => {
    createdAt += 1;
    const at = createdAt;
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("cards", {
        userId,
        type: "document",
        content: "",
        fileKey: `users/${userId}/cards/c/file/report.pdf`,
        fileMetadata: { fileName: "report.pdf", mimeType: "application/pdf" },
        createdAt: at,
        updatedAt: at,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });
  };

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId));
  const textRow = (cardId: Id<"cards">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardTextContents")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .unique()
    );
  const keyFor = async (cardId: Id<"cards">, fill = "a") => {
    const doc = await card(cardId);
    if (!doc) {
      throw new Error("missing card");
    }
    return documentTextKey(doc, digest(fill));
  };
  const save = async (cardId: Id<"cards">, text: string, fill = "a") =>
    await t.mutation(documentText.saveDocumentText, {
      cardId,
      key: await keyFor(cardId, fill),
      text,
      charCount: text.length,
      truncated: false,
    });
  /** Keys queued for deletion through the dispatch outbox. */
  const deletedKeys = () => queuedObjectDeletions(t);
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const search = async (searchQuery: string) => {
    const result = await owner.query(api.cards.searchCardsPaginated, {
      searchQuery,
      paginationOpts: { numItems: 20, cursor: null },
    });
    return result.page.map((item: { _id: string }) => item._id);
  };

  return {
    t,
    owner,
    strangerWorkosId,
    insert,
    card,
    textRow,
    keyFor,
    save,
    deletedKeys,
    runScheduled,
    search,
  };
};

describe("stored document text", () => {
  test("words and quoted phrases only inside a document find its card", async () => {
    const { insert, save, search } = await setup();
    const pdf = await insert();
    const other = await insert({
      type: "text",
      content: "Shipping notes",
      fileKey: undefined,
      fileMetadata: undefined,
    });
    expect(await search("Kestrel")).toEqual([]);

    expect(await save(pdf, PDF_TEXT)).toBe(true);

    expect(await search("Kestrel freight")).toEqual([pdf]);
    expect(await search('"net 30 days"')).toEqual([pdf]);
    expect(await search('"30 net days"')).toEqual([]);
    expect(await search("shipping")).toEqual(
      expect.arrayContaining([pdf, other])
    );
  });

  test("search covers the first 32 KiB; the row keeps the counts it was given", async () => {
    const { t, insert, textRow, keyFor, search } = await setup();
    const pdf = await insert();
    const filler = "lorem ".repeat(6000);
    const text = `${filler}\nzanzibar is past the prefix`;
    await t.mutation(documentText.saveDocumentText, {
      cardId: pdf,
      key: await keyFor(pdf),
      text,
      charCount: 1_000_000,
      truncated: true,
    });
    const row = await textRow(pdf);
    expect(new TextEncoder().encode(row?.text ?? "").byteLength).toBeLessThan(
      32 * 1024 + 1
    );
    expect(row).toMatchObject({ charCount: 1_000_000, truncated: true });
    expect(await search("zanzibar")).toEqual([]);
    expect(await search("lorem")).toEqual([pdf]);
  });

  test("a match in file text keeps the view's filters", async () => {
    const { t, owner, insert, save, search } = await setup();
    const kept = await insert();
    const trashed = await insert();
    const archived = await insert();
    const favorite = await insert();
    for (const cardId of [kept, trashed, archived, favorite]) {
      await save(cardId, PDF_TEXT);
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("cards", trashed, { isDeleted: true });
      await ctx.db.patch("cards", archived, { isArchived: true });
      await ctx.db.patch("cards", favorite, { isFavorited: true });
    });
    const searchView = async (view: Record<string, unknown>) =>
      (
        await owner.query(api.cards.searchCardsPaginated, {
          searchQuery: "kestrel",
          paginationOpts: { numItems: 20, cursor: null },
          ...view,
        })
      ).page.map((item: { _id: string }) => item._id);

    expect((await search("kestrel")).sort()).toEqual([favorite, kept].sort());
    expect(await searchView({ favoritesOnly: true })).toEqual([favorite]);
    expect(await searchView({ showTrashOnly: true })).toEqual([trashed]);
    expect(await searchView({ showArchivedOnly: true })).toEqual([archived]);
    expect(await searchView({ types: ["image"] })).toEqual([]);
  });

  test("file text stays out of the card's search document, and a search reads a bounded number of rows", async () => {
    const { t, insert, save } = await setup();
    const cards: Id<"cards">[] = [];
    for (let i = 0; i < FILE_TEXT_SEARCH_LIMIT + 3; i += 1) {
      const cardId = await insert();
      await save(
        cardId,
        `${PDF_TEXT}
row ${i}`
      );
      cards.push(cardId);
    }
    const found = await t.run(async (ctx) => {
      const document = await ctx.db
        .query("cardSearchDocuments")
        .withIndex("by_cardId", (q) => q.eq("cardId", cards[0]))
        .unique();
      expect(document?.searchableText).not.toContain("Kestrel");
      return await searchCardsByDocument(ctx, {
        userId: "owner",
        searchQuery: "kestrel",
        limit: 1024,
      });
    });
    expect(found).toHaveLength(FILE_TEXT_SEARCH_LIMIT);
  });

  test("new text replaces the old row and deletes the old object; the same text writes nothing", async () => {
    const { insert, save, card, textRow, keyFor, deletedKeys } = await setup();
    const pdf = await insert();
    await save(pdf, PDF_TEXT, "a");
    const first = await card(pdf);
    await save(pdf, PDF_TEXT, "a");
    expect((await card(pdf))?.updatedAt).toBe(first?.updatedAt);
    expect(await deletedKeys()).toEqual([]);

    await save(pdf, "Revised review", "b");
    expect((await card(pdf))?.documentTextKey).toBe(await keyFor(pdf, "b"));
    expect((await textRow(pdf))?.text).toBe("Revised review");
    expect(await deletedKeys()).toEqual([await keyFor(pdf, "a")]);
  });

  test("text for a card deleted meanwhile is not attached, and its object goes", async () => {
    const { t, insert, keyFor, deletedKeys } = await setup();
    const pdf = await insert();
    const key = await keyFor(pdf);
    await t.run((ctx) => ctx.db.delete("cards", pdf));
    expect(
      await t.mutation(documentText.saveDocumentText, {
        cardId: pdf,
        key,
        text: PDF_TEXT,
        charCount: PDF_TEXT.length,
        truncated: false,
      })
    ).toBe(false);
    expect(await deletedKeys()).toEqual([key]);
  });

  test("a key outside the card's namespace is refused", async () => {
    const { t, insert, keyFor } = await setup();
    const pdf = await insert();
    const other = await insert({}, "stranger");
    await expect(
      t.mutation(documentText.saveDocumentText, {
        cardId: pdf,
        key: await keyFor(other),
        text: PDF_TEXT,
        charCount: PDF_TEXT.length,
        truncated: false,
      })
    ).rejects.toThrow("document_text_invalid_key");
  });

  test("permanent delete removes the row and the stored object", async () => {
    const { t, insert, save, card, textRow, keyFor, deletedKeys } =
      await setup();
    const pdf = await insert();
    await save(pdf, PDF_TEXT);
    const key = await keyFor(pdf);
    expect(cardStorageObjectKeys((await card(pdf)) ?? {})).toContain(key);
    await t.run((ctx) =>
      ctx.db.patch("cards", pdf, { isDeleted: true, deletedAt: 5 })
    );
    await t.mutation(internal["card/deleteCard"].permanentDeleteCardForUser, {
      cardId: pdf,
      userId: "owner",
    });
    expect(await card(pdf)).toBeNull();
    expect(await textRow(pdf)).toBeNull();
    expect(await deletedKeys()).toContain(key);
  });

  test("account deletion removes the row and lists the object", async () => {
    const { t, insert, save, textRow, keyFor } = await setup();
    const pdf = await insert();
    await save(pdf, PDF_TEXT);
    const batch = await t.run((ctx) =>
      captureDeletionBatch(ctx, "owner", "cards")
    );
    expect(batch.keys).toContain(await keyFor(pdf));
    await t.run((ctx) => deleteAccountDataHandler(ctx, [pdf] as OwnedCardIds));
    expect(await textRow(pdf)).toBeNull();
  });
});

describe("getCardTextSource", () => {
  test("document text for the owner only, then transcript, then written content", async () => {
    const { t, insert, save, keyFor } = await setup();
    const pdf = await insert();
    await save(pdf, PDF_TEXT);
    const video = await insert({
      type: "video",
      aiTranscript: "Hello from the clip",
    });
    const note = await insert({
      type: "text",
      content: "A written note",
      fileKey: undefined,
      fileMetadata: undefined,
    });
    const image = await insert({ type: "image" });
    const source = (cardId: Id<"cards">, userId = "owner") =>
      t.query(documentText.getCardTextSource, { cardId, userId });

    expect(await source(pdf)).toEqual({
      cardId: pdf,
      kind: "document",
      text: PDF_TEXT,
      sourceKey: await keyFor(pdf),
      charCount: PDF_TEXT.length,
      truncated: false,
    });
    expect(await source(pdf, "stranger")).toBeNull();
    expect(await source(video)).toMatchObject({
      kind: "transcript",
      text: "Hello from the clip",
      charCount: 19,
    });
    expect(await source(note)).toMatchObject({
      kind: "content",
      text: "A written note",
    });
    expect(await source(image)).toBeNull();
  });
});

describe("backfillDocumentText", () => {
  test("a dry run counts documents without text and schedules nothing", async () => {
    const { t, insert, save } = await setup();
    await insert();
    await insert();
    const done = await insert();
    await save(done, PDF_TEXT);
    await insert({ isDeleted: true, deletedAt: 1 });
    await insert({ fileKey: undefined });
    await insert({ type: "text", fileKey: undefined, content: "note" });

    const result = await t.mutation(backfill.backfillDocumentText, {});
    expect(result).toMatchObject({
      dryRun: true,
      isDone: true,
      totals: { examined: 5, cardsToExtract: 2, skippedDeletingAccounts: 0 },
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    expect(
      scheduled.filter((job) => job.name.startsWith("migration/"))
    ).toEqual([]);
  });

  test("a real run spaces one extraction per card and resumes page by page", async () => {
    const { t, insert } = await setup();
    const ids = [await insert(), await insert(), await insert()];
    const first = await t.mutation(backfill.backfillDocumentText, {
      dryRun: false,
      batchSize: 2,
      spacingMs: 1000,
    });
    expect(first).toMatchObject({
      isDone: false,
      continuationScheduled: true,
      batch: { cardsToExtract: 2 },
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const extractions = scheduled.filter((job) =>
      job.name.includes("extractDocumentText")
    );
    expect(extractions.map((job) => (job.args[0] as any).cardId)).toEqual(
      ids.slice(0, 2)
    );
    const times = extractions.map((job) => job.scheduledTime);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBe(1000);
    const next = scheduled.find((job) =>
      job.name.includes("backfillDocumentText")
    );
    expect(next?.scheduledTime).toBe((times[0] ?? 0) + 2000);
    expect((next?.args[0] as any)?.cursor).toBe(first.continueCursor);
  });
});
