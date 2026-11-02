import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { createCardForUserHandler } from "../card/createCard";
import { syncCardSearchDocumentHandler } from "../card/searchSync";
import { FOLDER_RULE_BATCH_SIZE } from "../folder/rules";
import schema from "../schema";
import type { TeakUserId } from "../securitySessions";
import {
  FOLDER_ERROR_MESSAGES,
  FOLDER_RULE_RUN_UNDO_MS,
  MAX_FOLDER_AUTO_TAGS,
  MAX_FOLDER_RULES,
} from "../shared/folders";
import { queueCardProcessing } from "../workflowDispatch";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.UTC(2026, 10, 1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type CardSeed = Partial<Omit<Doc<"cards">, "_id" | "_creationTime" | "userId">>;

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, "owner");
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_owner",
    email_verified: true,
    external_id: "owner",
  });

  let order = 0;
  const insert = (seed: CardSeed = {}) =>
    t.run(async (ctx) => {
      order += 1;
      const id = await ctx.db.insert("cards", {
        userId: "owner",
        type: "text",
        content: `Card ${order}`,
        createdAt: order,
        updatedAt: order,
        ...seed,
      });
      await syncCardSearchDocumentHandler(ctx, id);
      return id;
    });

  const createFolder = (
    name: string,
    rules: {
      autoFileEnabled?: boolean;
      autoFileQuery?: string | null;
      autoTags?: string[];
    } = {}
  ) => owner.mutation(api.folders.createFolder, { name, ...rules });

  const updateRules = (
    folderId: Id<"folders">,
    rules: {
      autoFileEnabled?: boolean;
      autoFileQuery?: string | null;
      autoTags?: string[];
      name?: string;
    }
  ) => owner.mutation(api.folders.updateFolder, { folderId, ...rules });

  const card = (cardId: Id<"cards">) =>
    t.run((ctx) => ctx.db.get("cards", cardId)) as Promise<Doc<"cards">>;

  const writeAiTags = (cardId: Id<"cards">, aiTags: string[]) =>
    t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId,
      aiTags,
      aiSummary: "A summary",
      processingStatus: { metadata: { status: "completed" } },
    });

  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  const run = (folderId: Id<"folders">, runId: Id<"folderRuleRuns">) =>
    owner.query(api.folders.getFolderRuleRun, { folderId, runId });

  return {
    t,
    owner,
    insert,
    createFolder,
    updateRules,
    card,
    writeAiTags,
    runScheduled,
    run,
  };
};

describe("auto-file rules", () => {
  test("new AI tags file the card and add the folder's tags, in one pass", async () => {
    const { insert, createFolder, card, writeAiTags, runScheduled } =
      await setup();
    const design = await createFolder("Design", {
      autoFileQuery: "tag:typography",
      autoTags: ["design"],
    });
    // Matches the tag Design adds, but rules don't chain.
    const tagged = await createFolder("Tagged design", {
      autoFileQuery: "tag:design",
    });
    await runScheduled();

    const id = await insert();
    expect((await card(id)).folderIds).toBeUndefined();

    await writeAiTags(id, ["typography", "fonts"]);
    const filed = await card(id);
    expect(filed.folderIds).toEqual([design._id]);
    expect(filed.tags).toEqual(["design"]);
    expect(filed.aiTags).toEqual(["typography", "fonts"]);
    expect(filed.folderIds).not.toContain(tagged._id);
  });

  test("an OCR-only write files nothing", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    await createFolder("Receipts", { autoFileQuery: "receipt" });
    await runScheduled();
    const id = await insert({ content: "receipt from the shop" });

    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: id,
      aiOcrText: "TOTAL 12.00",
    });
    expect((await card(id)).folderIds).toBeUndefined();
  });

  test("a card taken out by hand stays out when its AI tags are written again", async () => {
    const { owner, insert, createFolder, card, writeAiTags, runScheduled } =
      await setup();
    const folder = await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    await runScheduled();
    const id = await insert();
    await writeAiTags(id, ["fonts"]);
    expect((await card(id)).folderIds).toEqual([folder._id]);

    await owner.mutation(api.folders.removeCardsFromFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    await writeAiTags(id, ["fonts", "serif"]);
    expect((await card(id)).folderIds).toBeUndefined();
  });

  test("a paused rule files nothing until it is turned back on", async () => {
    const {
      insert,
      createFolder,
      updateRules,
      card,
      writeAiTags,
      runScheduled,
    } = await setup();
    const folder = await createFolder("Fonts", {
      autoFileQuery: "tag:fonts",
      autoFileEnabled: false,
    });
    expect(folder.rules).toEqual({
      autoTags: [],
      autoFile: { query: "tag:fonts", enabled: false },
    });
    await runScheduled();
    const id = await insert();
    await writeAiTags(id, ["fonts"]);
    expect((await card(id)).folderIds).toBeUndefined();

    const resumed = await updateRules(folder._id, { autoFileEnabled: true });
    expect(resumed.ruleRunId).toBeDefined();
    await runScheduled();
    expect((await card(id)).folderIds).toEqual([folder._id]);
  });

  test("a run that ends without AI tags files the card with what it has", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    const folder = await createFolder("Notes about cats", {
      autoFileQuery: "cats",
    });
    await runScheduled();
    const id = await insert({
      content: "notes about cats",
      processingStatus: { metadata: { status: "in_progress" } },
    });
    const queued = await t.run((ctx) => queueCardProcessing(ctx, id));
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "errored",
    });
    expect((await card(id)).folderIds).toEqual([folder._id]);
  });

  test("a card still waiting on the AI backfill isn't filed when its run ends", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    await createFolder("Cats", { autoFileQuery: "cats" });
    await runScheduled();
    const id = await insert({
      content: "cats",
      processingStatus: { metadata: { status: "pending" } },
    });
    const queued = await t.run((ctx) => queueCardProcessing(ctx, id));
    await t.mutation(internal.workflowDispatch.claim, {});
    await t.mutation(internal.workflowDispatch.complete, {
      instanceId: queued?.instanceId as string,
      status: "complete",
    });
    expect((await card(id)).folderIds).toBeUndefined();
  });
});

describe("auto-file triggers", () => {
  test("a summary alone files the card, as from the AI backfill", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    const folder = await createFolder("Bread", { autoFileQuery: "sourdough" });
    await runScheduled();
    const id = await insert({ content: "sourdough loaf" });
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: id,
      aiSummary: "A loaf",
      processingStatus: { metadata: { status: "completed" } },
    });
    expect((await card(id)).folderIds).toEqual([folder._id]);
  });

  test("text read from a link's image after AI files it; before AI it doesn't", async () => {
    const { t, insert, createFolder, card, writeAiTags, runScheduled } =
      await setup();
    const folder = await createFolder("Receipts", {
      autoFileQuery: 'text:"total due"',
    });
    await runScheduled();
    const early = await insert({ type: "link", content: "https://a.example" });
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: early,
      aiOcrText: "TOTAL DUE 12.00",
    });
    expect((await card(early)).folderIds).toBeUndefined();

    const late = await insert({ type: "link", content: "https://b.example" });
    await writeAiTags(late, ["shop"]);
    expect((await card(late)).folderIds).toBeUndefined();
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: late,
      aiOcrText: "TOTAL DUE 12.00",
    });
    expect((await card(late)).folderIds).toEqual([folder._id]);
  });

  test("a transcript written with the AI tags files the card", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    const folder = await createFolder("Studio", { autoFileQuery: "crowded" });
    await runScheduled();
    const memo = await insert({ type: "audio", content: "Voice memo" });
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: memo,
      aiTags: ["memo"],
      aiTranscript: "the crowded studio was loud",
      processingStatus: { metadata: { status: "completed" } },
    });
    expect((await card(memo)).folderIds).toEqual([folder._id]);
  });

  test("words the same AI write replaces don't match", async () => {
    const { t, insert, createFolder, card, runScheduled } = await setup();
    await createFolder("Pottery", { autoFileQuery: "pottery" });
    await runScheduled();
    const id = await insert({
      content: "Weekend notes",
      aiSummary: "Notes from a pottery class",
    });
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: id,
      aiTags: ["bread"],
      aiSummary: "Notes about baking bread",
      processingStatus: { metadata: { status: "completed" } },
    });
    expect((await card(id)).folderIds).toBeUndefined();
  });

  test("a transcript written after the AI files the card", async () => {
    const { t, insert, createFolder, card, writeAiTags, runScheduled } =
      await setup();
    const folder = await createFolder("Studio", { autoFileQuery: "crowded" });
    await runScheduled();
    const episode = await insert({
      type: "link",
      content: "https://pod.example",
    });
    await writeAiTags(episode, ["podcast"]);
    expect((await card(episode)).folderIds).toBeUndefined();
    await t.mutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
      cardId: episode,
      aiTranscript: "the crowded studio was loud",
    });
    expect((await card(episode)).folderIds).toEqual([folder._id]);
  });

  test("words only a transcript holds match", async () => {
    const { insert, createFolder, card, runScheduled } = await setup();
    const memo = await insert({
      type: "audio",
      content: "Voice memo",
      aiTranscript: "the crowded studio was loud",
    });
    const folder = await createFolder("Studio", { autoFileQuery: "crowded" });
    await runScheduled();
    expect((await card(memo)).folderIds).toEqual([folder._id]);
  });
});

describe("auto-tags", () => {
  test("every way into the folder adds its tags", async () => {
    const { t, owner, insert, createFolder, card, runScheduled } =
      await setup();
    const folder = await createFolder("Reading", { autoTags: ["to-read"] });
    const other = await createFolder("Other");
    await runScheduled();
    const added = await insert();
    const set = await insert();
    const bulk = await insert();
    const moved = await insert({ folderIds: [other._id] });

    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folder._id,
      cardIds: [added],
    });
    await owner.mutation(api.folders.setCardFolders, {
      cardId: set,
      folderIds: [folder._id],
    });
    await owner.mutation(api.cards.bulkUpdateCards, {
      cardIds: [bulk],
      action: "addToFolder",
      folderId: folder._id,
    });
    await owner.mutation(api.folders.moveCardsToFolder, {
      cardIds: [moved],
      folderId: folder._id,
      fromFolderId: other._id,
    });
    const imported = await t.run(async (ctx) => {
      const outcome = await createCardForUserHandler(
        ctx,
        "owner" as TeakUserId,
        { content: "From an import" },
        {
          resolveFolderIds: async () => [folder._id],
          skipResave: true,
          source: "import",
        }
      );
      return outcome.cardId;
    });

    for (const id of [added, set, bulk, moved, imported]) {
      expect((await card(id)).tags).toEqual(["to-read"]);
    }
  });

  test("a tag taken off by hand isn't added again when the card rejoins", async () => {
    const { owner, insert, createFolder, card, runScheduled } = await setup();
    const folder = await createFolder("Reading", {
      autoTags: ["to-read", "Later"],
    });
    await runScheduled();
    const id = await insert({ tags: ["later"] });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    expect((await card(id)).tags).toEqual(["later", "to-read"]);

    await owner.mutation(api.cards.updateCard, { id, tags: [] });
    await owner.mutation(api.folders.removeCardsFromFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    expect((await card(id)).tags).toBeUndefined();
  });

  test("hidden tags hide the cards put in the folder", async () => {
    const { owner, insert, createFolder, card, runScheduled } = await setup();
    const folder = await createFolder("Private", { autoTags: ["secret"] });
    await runScheduled();
    const id = await insert();
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    expect(await card(id)).toMatchObject({ tags: ["secret"], isHidden: true });
  });
});

describe("rule runs", () => {
  test("saving rules tags the folder's cards and files matching ones, archived too but not Trash", async () => {
    const {
      owner,
      insert,
      createFolder,
      updateRules,
      card,
      run,
      runScheduled,
    } = await setup();
    const folder = await createFolder("Fonts");
    const member = await insert({ folderIds: [folder._id] });
    const match = await insert({ aiTags: ["fonts"] });
    const archived = await insert({ aiTags: ["fonts"], isArchived: true });
    const trashed = await insert({ aiTags: ["fonts"], isDeleted: true });
    const other = await insert({ aiTags: ["cats"] });

    const saved = await updateRules(folder._id, {
      autoTags: ["type"],
      autoFileQuery: "tag:fonts",
    });
    expect(saved.rules).toEqual({
      autoTags: ["type"],
      autoFile: { query: "tag:fonts", enabled: true },
    });
    const runId = saved.ruleRunId as Id<"folderRuleRuns">;
    await runScheduled();

    expect(await run(folder._id, runId)).toMatchObject({
      status: "done",
      filedCount: 2,
      taggedCount: 3,
      canUndo: true,
    });
    expect(await card(member)).toMatchObject({ tags: ["type"] });
    for (const id of [match, archived]) {
      expect(await card(id)).toMatchObject({
        folderIds: [folder._id],
        tags: ["type"],
      });
    }
    expect((await card(trashed)).folderIds).toBeUndefined();
    expect((await card(other)).folderIds).toBeUndefined();

    const listed = await owner.query(api.folders.getFolder, {
      folderId: folder._id,
    });
    expect(listed?.ruleRunId).toBe(runId);
  });

  test("a run pages through a library bigger than one batch", async () => {
    const { insert, createFolder, card, run, runScheduled } = await setup();
    const ids: Id<"cards">[] = [];
    for (let index = 0; index < FOLDER_RULE_BATCH_SIZE * 2 + 3; index += 1) {
      ids.push(await insert({ aiTags: ["fonts"] }));
    }
    const folder = await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    await runScheduled();
    expect(
      await run(folder._id, folder.ruleRunId as Id<"folderRuleRuns">)
    ).toMatchObject({ status: "done", filedCount: ids.length });
    expect((await card(ids[ids.length - 1] as Id<"cards">)).folderIds).toEqual([
      folder._id,
    ]);
  });

  test("undo takes back only what is still true, and the rule doesn't redo it", async () => {
    const {
      owner,
      insert,
      createFolder,
      updateRules,
      card,
      run,
      writeAiTags,
      runScheduled,
    } = await setup();
    const folder = await createFolder("Fonts");
    const kept = await insert({ aiTags: ["fonts"] });
    const retagged = await insert({ aiTags: ["fonts"] });
    const saved = await updateRules(folder._id, {
      autoTags: ["type"],
      autoFileQuery: "tag:fonts",
    });
    const runId = saved.ruleRunId as Id<"folderRuleRuns">;
    await runScheduled();
    // Someone takes the tag off by hand and adds another, then undoes.
    await owner.mutation(api.cards.updateCard, {
      id: retagged,
      tags: ["mine"],
    });

    await owner.mutation(api.folders.undoFolderRuleRun, {
      folderId: folder._id,
      runId,
    });
    await runScheduled();

    expect(await run(folder._id, runId)).toMatchObject({
      status: "undone",
      canUndo: false,
    });
    const keptCard = await card(kept);
    expect([keptCard.folderIds, keptCard.tags]).toEqual([undefined, undefined]);
    const retaggedCard = await card(retagged);
    expect([retaggedCard.folderIds, retaggedCard.tags]).toEqual([
      undefined,
      ["mine"],
    ]);

    await writeAiTags(kept, ["fonts"]);
    expect((await card(kept)).folderIds).toBeUndefined();
  });

  test("a run can't be undone after a day", async () => {
    const { owner, insert, createFolder, run, runScheduled } = await setup();
    await insert({ aiTags: ["fonts"] });
    const folder = await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    const runId = folder.ruleRunId as Id<"folderRuleRuns">;
    await runScheduled();
    vi.setSystemTime(NOW + FOLDER_RULE_RUN_UNDO_MS + 1);
    expect((await run(folder._id, runId))?.canUndo).toBe(false);
    await expect(
      owner.mutation(api.folders.undoFolderRuleRun, {
        folderId: folder._id,
        runId,
      })
    ).rejects.toThrow(FOLDER_ERROR_MESSAGES.RULE_RUN_EXPIRED);
  });

  test("saving again ends the run still going", async () => {
    const { insert, createFolder, updateRules, run, runScheduled } =
      await setup();
    for (let index = 0; index < FOLDER_RULE_BATCH_SIZE + 1; index += 1) {
      await insert({ aiTags: ["fonts", "serif"] });
    }
    const folder = await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    const first = folder.ruleRunId as Id<"folderRuleRuns">;
    const second = (
      await updateRules(folder._id, { autoFileQuery: "tag:serif" })
    ).ruleRunId as Id<"folderRuleRuns">;
    await runScheduled();
    expect((await run(folder._id, first))?.status).toBe("superseded");
    expect((await run(folder._id, second))?.status).toBe("done");
  });

  test("saving tags while a filing run is going still files every match", async () => {
    const { insert, createFolder, updateRules, card, runScheduled } =
      await setup();
    const ids: Id<"cards">[] = [];
    for (let index = 0; index < FOLDER_RULE_BATCH_SIZE + 2; index += 1) {
      ids.push(await insert({ aiTags: ["fonts"] }));
    }
    const folder = await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    await updateRules(folder._id, { autoTags: ["type"] });
    await runScheduled();
    for (const id of ids) {
      expect(await card(id)).toMatchObject({
        folderIds: [folder._id],
        tags: ["type"],
      });
    }
  });

  test("cleanup deletes runs stuck past their day, and stops", async () => {
    const { t, runScheduled } = await setup();
    await t.run(async (ctx) => {
      const folderId = await ctx.db.insert("folders", {
        userId: "owner",
        name: "Stuck",
        nameKey: "stuck",
        kind: "manual",
        activeCardCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("folderRuleRuns", {
          userId: "owner",
          folderId,
          status: index % 2 === 0 ? "running" : "undoing",
          phase: "file",
          filedCount: 0,
          taggedCount: 0,
          createdAt: index,
          updatedAt: index,
          expiresAt: index,
        });
      }
    });
    await t.mutation(internal.folder.rules.deleteExpiredFolderRuleRuns, {});
    await runScheduled();
    expect(
      await t.run((ctx) => ctx.db.query("folderRuleRuns").collect())
    ).toEqual([]);
  });

  test("expired runs are cleaned up with their changes", async () => {
    const { t, insert, createFolder, runScheduled } = await setup();
    await insert({ aiTags: ["fonts"] });
    await createFolder("Fonts", { autoFileQuery: "tag:fonts" });
    await runScheduled();
    vi.setSystemTime(NOW + FOLDER_RULE_RUN_UNDO_MS + 1);
    await t.mutation(internal.folder.rules.deleteExpiredFolderRuleRuns, {});
    const left = await t.run(async (ctx) => ({
      runs: await ctx.db.query("folderRuleRuns").collect(),
      changes: await ctx.db.query("folderRuleRunChanges").collect(),
    }));
    expect(left).toEqual({ runs: [], changes: [] });
  });
});

describe("rule validation", () => {
  test("rules refuse like:, mood:, too many tags and smart folders", async () => {
    const { owner, createFolder } = await setup();
    await expect(
      createFolder("Mood", { autoFileQuery: "mood:calm" })
    ).rejects.toThrow(FOLDER_ERROR_MESSAGES.RULE_QUERY_SIMILARITY);
    await expect(
      createFolder("Tags", {
        autoTags: Array.from(
          { length: MAX_FOLDER_AUTO_TAGS + 1 },
          (_, index) => `tag${index}`
        ),
      })
    ).rejects.toThrow(FOLDER_ERROR_MESSAGES.TOO_MANY_AUTO_TAGS);
    await expect(
      owner.mutation(api.folders.createFolder, {
        name: "Smart",
        query: "type:image",
        autoTags: ["x"],
      })
    ).rejects.toThrow(FOLDER_ERROR_MESSAGES.RULES_ON_SMART_FOLDER);
  });

  test(`an account can have rules on up to ${MAX_FOLDER_RULES} folders`, async () => {
    const { t, createFolder } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < MAX_FOLDER_RULES; index += 1) {
        await ctx.db.insert("folders", {
          userId: "owner",
          name: `Rule ${index}`,
          nameKey: `rule ${index}`,
          kind: "manual",
          autoTags: ["x"],
          hasRules: true,
          activeCardCount: 0,
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    await expect(
      createFolder("One too many", { autoTags: ["y"] })
    ).rejects.toThrow(FOLDER_ERROR_MESSAGES.TOO_MANY_RULES);
    await expect(createFolder("No rules")).resolves.toBeTruthy();
  });

  test("clearing every rule frees the folder's place", async () => {
    const { t, createFolder, updateRules } = await setup();
    const folder = await createFolder("Fonts", { autoTags: ["type"] });
    const cleared = await updateRules(folder._id, { autoTags: [] });
    expect(cleared.rules).toEqual({ autoTags: [], autoFile: null });
    expect(
      (await t.run((ctx) => ctx.db.get("folders", folder._id)))?.hasRules
    ).toBeUndefined();
  });

  test("renaming a folder renames it inside rule searches", async () => {
    const { createFolder, updateRules, t } = await setup();
    const source = await createFolder("Inbox");
    const rule = await createFolder("From inbox", {
      autoFileQuery: "folder:inbox",
    });
    await updateRules(source._id, { name: "Triage" });
    expect(
      (await t.run((ctx) => ctx.db.get("folders", rule._id)))?.autoFileQuery
    ).toBe("folder:Triage");
  });
});

describe("cleanup", () => {
  test("deleting a card for good removes all its rule records, past one batch", async () => {
    const { t, owner, insert, runScheduled } = await setup();
    const id = await insert({ isDeleted: true, deletedAt: 1 });
    await t.run(async (ctx) => {
      for (let index = 0; index < 130; index += 1) {
        const folderId = await ctx.db.insert("folders", {
          userId: "owner",
          name: `Old ${index}`,
          nameKey: `old ${index}`,
          kind: "manual",
          activeCardCount: 0,
          createdAt: index,
          updatedAt: index,
        });
        await ctx.db.insert("folderRuleApplications", {
          userId: "owner",
          cardId: id,
          folderId,
          filed: true,
          tagKeys: [],
        });
      }
    });
    await owner.mutation(api.cards.permanentDeleteCard, { id });
    await runScheduled();
    expect(
      await t.run((ctx) => ctx.db.query("folderRuleApplications").collect())
    ).toEqual([]);
  });

  test("deleting a folder or a card for good removes its rule records", async () => {
    const { t, owner, insert, createFolder, runScheduled } = await setup();
    const folder = await createFolder("Fonts", { autoTags: ["type"] });
    const keep = await createFolder("Keep", { autoTags: ["kept"] });
    const id = await insert();
    const other = await insert({ isDeleted: true, deletedAt: 1 });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: folder._id,
      cardIds: [id],
    });
    await owner.mutation(api.folders.addCardsToFolder, {
      folderId: keep._id,
      cardIds: [id],
    });
    await t.run((ctx) =>
      ctx.db.insert("folderRuleApplications", {
        userId: "owner",
        cardId: other,
        folderId: keep._id,
        filed: true,
        tagKeys: [],
      })
    );

    await owner.mutation(api.folders.deleteFolder, { folderId: folder._id });
    await runScheduled();
    await owner.mutation(api.cards.permanentDeleteCard, { id: other });

    const rows = await t.run((ctx) =>
      ctx.db.query("folderRuleApplications").collect()
    );
    expect(rows.map((row) => [row.cardId, row.folderId])).toEqual([
      [id, keep._id],
    ]);
  });
});
