import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { queueCardProcessing } from "../workflowDispatch";

const modules = import.meta.glob("../**/*.ts");
const NOW = new Date("2026-10-24T10:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;

const insertCard = (t: T, fields: Partial<Doc<"cards">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("cards", {
      content: "来週、東京でデザイン展を見に行く。",
      createdAt: NOW - 1000,
      processingRev: 1,
      type: "text",
      updatedAt: NOW - 1000,
      userId: "owner",
      ...fields,
    })
  );

const card = (t: T, cardId: Id<"cards">) =>
  t.run((ctx) => ctx.db.get("cards", cardId));

// The metadata write as a card-processing run makes it, under its revision.
const saveAi = (
  t: T,
  cardId: Id<"cards">,
  args: Record<string, unknown>,
  rev = 1
) =>
  t.mutation(internal.workflowGateway.runGuarded, {
    args: { cardId, ...args },
    cardId,
    name: "workflows/aiMetadata/mutations:updateCardAI",
    rev,
  });

describe("cards.aiLanguage", () => {
  test("is stored with the AI tags and summary", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t);
    await saveAi(t, cardId, {
      aiLanguage: "ja",
      aiSummary: "東京のデザイン展についてのメモ。",
      aiTags: ["デザイン", "東京"],
    });
    expect(await card(t, cardId)).toMatchObject({
      aiLanguage: "ja",
      aiSummary: "東京のデザイン展についてのメモ。",
      aiTags: ["デザイン", "東京"],
    });
  });

  test("new AI output overwrites it, and clears it when it has none", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      aiLanguage: "en",
      aiSummary: "A note about a design show in Tokyo.",
      aiTags: ["design"],
    });
    await saveAi(t, cardId, {
      aiLanguage: "ja",
      aiSummary: "東京のデザイン展についてのメモ。",
    });
    expect((await card(t, cardId))?.aiLanguage).toBe("ja");

    await saveAi(t, cardId, { aiSummary: "A note.", aiTags: ["note"] });
    const cleared = await card(t, cardId);
    expect(cleared?.aiSummary).toBe("A note.");
    expect(cleared).not.toHaveProperty("aiLanguage");
  });

  test("a write without new tags or a summary leaves it alone", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      aiLanguage: "ja",
      aiSummary: "東京のメモ。",
    });
    // Link image text and a podcast transcript whose summary failed write
    // only these.
    await saveAi(t, cardId, { aiOcrText: "東京駅 出口", ocrCheckedAt: NOW });
    expect((await card(t, cardId))?.aiLanguage).toBe("ja");
  });

  test("a write from a replaced run changes nothing", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      aiLanguage: "ja",
      aiSummary: "東京のメモ。",
      processingRev: 2,
    });
    await expect(
      saveAi(t, cardId, { aiLanguage: "en", aiSummary: "A note." }, 1)
    ).rejects.toThrow("stale_processing_revision");
    expect(await card(t, cardId)).toMatchObject({
      aiLanguage: "ja",
      aiSummary: "東京のメモ。",
    });
  });

  test("Refresh details clears it with the old AI output", async () => {
    const t = convexTest(schema, modules);
    const cardId = await insertCard(t, {
      aiLanguage: "en",
      aiSummary: "A note about a design show in Tokyo.",
      aiTags: ["design"],
    });
    await t.run((ctx) =>
      queueCardProcessing(ctx, cardId, { refresh: true, reset: true })
    );
    // The reset lands when the run is handed to the Files Worker.
    await t.mutation(internal.workflowDispatch.claim, {});
    const refreshed = await card(t, cardId);
    expect(refreshed).not.toHaveProperty("aiLanguage");
    expect(refreshed).not.toHaveProperty("aiSummary");
    expect(refreshed?.processingRev).toBe(2);
  });
});
