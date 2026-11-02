import type { PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { resolveSearch } from "../card/searchPlanner";
import {
  buildCardSearchText,
  patchCardWithSearchSync,
} from "../card/searchSync";
import { readCardTranscript } from "../card/textContents";
import { getSessionUser, requireSessionUserId } from "../securitySessions";
import {
  FOLDER_ERROR_MESSAGES,
  FOLDER_RULE_RUN_UNDO_MS,
  MAX_FOLDER_AUTO_TAGS,
  MAX_FOLDER_RULES,
  MAX_FOLDERS_PER_CARD,
} from "../shared/folders";
import { parseSearchQuery } from "../shared/search/qualifiers";
import {
  explainInvalidTagName,
  MAX_CARD_TAGS,
  normalizeTagList,
  tagKey,
} from "../shared/tags";
import { normalizeSmartFolderQuery, requireFolderForUser } from "./folders";

export const FOLDER_RULE_BATCH_SIZE = 25;

export interface FolderRuleInput {
  autoFileEnabled?: boolean;
  /** null or "" clears the rule. */
  autoFileQuery?: string | null;
  autoTags?: readonly string[];
}

const invalidInput = (message: string) =>
  new ConvexError({ code: "INVALID_INPUT", message });

const hasRules = (
  fields: Pick<Doc<"folders">, "autoFileQuery" | "autoTags">
): boolean =>
  (fields.autoTags?.length ?? 0) > 0 || fields.autoFileQuery !== undefined;

const normalizeAutoTags = (tags: readonly string[]): string[] => {
  for (const tag of tags) {
    const reason = explainInvalidTagName(tag);
    if (reason) {
      throw invalidInput(reason);
    }
  }
  const normalized = normalizeTagList(tags);
  if (normalized.length > MAX_FOLDER_AUTO_TAGS) {
    throw invalidInput(FOLDER_ERROR_MESSAGES.TOO_MANY_AUTO_TAGS);
  }
  return normalized;
};

export const normalizeAutoFileQuery = async (
  ctx: QueryCtx,
  userId: string,
  raw: string
): Promise<string> => {
  if (!raw.trim()) {
    throw invalidInput(FOLDER_ERROR_MESSAGES.EMPTY_RULE_QUERY);
  }
  const parsed = parseSearchQuery(raw);
  if (
    parsed.similarity ||
    parsed.qualifiers.some((q) => q.key === "like" || q.key === "mood")
  ) {
    throw invalidInput(FOLDER_ERROR_MESSAGES.RULE_QUERY_SIMILARITY);
  }
  return await normalizeSmartFolderQuery(ctx, userId, raw);
};

const countRuleFolders = async (
  ctx: QueryCtx,
  userId: string
): Promise<number> => {
  let count = 0;
  for await (const folder of ctx.db
    .query("folders")
    .withIndex("by_userId_and_hasRules", (q) =>
      q.eq("userId", userId).eq("hasRules", true)
    )) {
    if (folder.deletingAt === undefined) {
      count += 1;
      if (count >= MAX_FOLDER_RULES) {
        break;
      }
    }
  }
  return count;
};

/**
 * The folder fields a rule change writes, and which parts of the rules a run
 * over the library has to apply. Rules only add, so a run applies new tags
 * and a new or turned-on search, never takes back what an older rule did.
 */
export const planFolderRuleChange = async (
  ctx: QueryCtx,
  userId: string,
  folder: Pick<
    Doc<"folders">,
    "autoFilePaused" | "autoFileQuery" | "autoTags" | "hasRules" | "kind"
  >,
  input: FolderRuleInput
): Promise<{
  patch: Partial<Doc<"folders">>;
  runFile: boolean;
  runTags: boolean;
}> => {
  const touches =
    input.autoTags !== undefined ||
    input.autoFileQuery !== undefined ||
    input.autoFileEnabled !== undefined;
  if (!touches) {
    return { patch: {}, runFile: false, runTags: false };
  }
  if (folder.kind !== "manual") {
    throw invalidInput(FOLDER_ERROR_MESSAGES.RULES_ON_SMART_FOLDER);
  }
  const next = {
    autoTags: folder.autoTags,
    autoFileQuery: folder.autoFileQuery,
    autoFilePaused: folder.autoFilePaused,
  };
  if (input.autoTags !== undefined) {
    const tags = normalizeAutoTags(input.autoTags);
    next.autoTags = tags.length > 0 ? tags : undefined;
  }
  if (input.autoFileQuery !== undefined) {
    if (input.autoFileQuery === null || !input.autoFileQuery.trim()) {
      next.autoFileQuery = undefined;
      next.autoFilePaused = undefined;
    } else if (
      parseSearchQuery(input.autoFileQuery).canonical !== folder.autoFileQuery
    ) {
      next.autoFileQuery = await normalizeAutoFileQuery(
        ctx,
        userId,
        input.autoFileQuery
      );
    }
  }
  if (input.autoFileEnabled !== undefined && next.autoFileQuery !== undefined) {
    next.autoFilePaused = input.autoFileEnabled ? undefined : true;
  }

  const patch: Partial<Doc<"folders">> = {};
  const sameTags =
    (next.autoTags ?? []).join("\u0000") ===
    (folder.autoTags ?? []).join("\u0000");
  if (!sameTags) {
    patch.autoTags = next.autoTags;
  }
  if (next.autoFileQuery !== folder.autoFileQuery) {
    patch.autoFileQuery = next.autoFileQuery;
  }
  if (next.autoFilePaused !== folder.autoFilePaused) {
    patch.autoFilePaused = next.autoFilePaused;
  }
  if (Object.keys(patch).length === 0) {
    return { patch, runFile: false, runTags: false };
  }
  const nextHasRules = hasRules(next);
  if (
    nextHasRules &&
    folder.hasRules !== true &&
    (await countRuleFolders(ctx, userId)) >= MAX_FOLDER_RULES
  ) {
    throw new ConvexError({
      code: "RULE_LIMIT",
      message: FOLDER_ERROR_MESSAGES.TOO_MANY_RULES,
    });
  }
  if (nextHasRules !== (folder.hasRules === true)) {
    patch.hasRules = nextHasRules ? true : undefined;
  }
  const oldTagKeys = new Set((folder.autoTags ?? []).map(tagKey));
  const runTags = (next.autoTags ?? []).some(
    (tag) => !oldTagKeys.has(tagKey(tag))
  );
  const wasFiling =
    folder.autoFileQuery !== undefined && folder.autoFilePaused !== true;
  const isFiling =
    next.autoFileQuery !== undefined && next.autoFilePaused !== true;
  const runFile =
    isFiling && (!wasFiling || next.autoFileQuery !== folder.autoFileQuery);
  return { patch, runFile, runTags };
};

const readApplication = (
  ctx: QueryCtx,
  cardId: Id<"cards">,
  folderId: Id<"folders">
) =>
  ctx.db
    .query("folderRuleApplications")
    .withIndex("by_cardId_and_folderId", (q) =>
      q.eq("cardId", cardId).eq("folderId", folderId)
    )
    .unique();

const recordApplication = async (
  ctx: MutationCtx,
  card: Pick<Doc<"cards">, "_id" | "userId">,
  folderId: Id<"folders">,
  existing: Doc<"folderRuleApplications"> | null,
  tagKeys: readonly string[]
) => {
  const keys = Array.from(new Set([...(existing?.tagKeys ?? []), ...tagKeys]));
  if (existing) {
    if (existing.filed === true && keys.length === existing.tagKeys.length) {
      return;
    }
    await ctx.db.patch("folderRuleApplications", existing._id, {
      filed: true,
      tagKeys: keys,
    });
    return;
  }
  await ctx.db.insert("folderRuleApplications", {
    userId: card.userId,
    cardId: card._id,
    folderId,
    filed: true,
    tagKeys: keys,
  });
};

export interface AutoTagResult {
  /** Tags added, by the folder that added them. */
  added: Map<Id<"folders">, string[]>;
  /** The card's whole tag list when it changed. */
  tags?: string[];
}

/**
 * Adds the auto-tags of every rule folder the card joins, however it joins:
 * by hand, in bulk, from the API, an import or an auto-file rule. A tag the
 * rule already gave the card once is never added again, so taking it off by
 * hand sticks. Writes what it did to `folderRuleApplications`; the caller
 * writes the returned tags with the card's new folders.
 */
export const autoTagsForJoinedFolders = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  nextFolderIds: readonly Id<"folders">[],
  previousFolderIds: readonly Id<"folders">[] = card.folderIds ?? []
): Promise<AutoTagResult> => {
  const added = new Map<Id<"folders">, string[]>();
  const joined = nextFolderIds.filter((id) => !previousFolderIds.includes(id));
  if (joined.length === 0 || card.isDeleted === true) {
    return { added };
  }
  const tags = [...(card.tags ?? [])];
  const keys = new Set(tags.map(tagKey));
  for (const folderId of joined) {
    const folder = await ctx.db.get("folders", folderId);
    if (
      folder?.hasRules !== true ||
      folder.userId !== card.userId ||
      folder.deletingAt !== undefined
    ) {
      continue;
    }
    const existing = await readApplication(ctx, card._id, folderId);
    const done = new Set(existing?.tagKeys ?? []);
    const applied: string[] = [];
    const addedHere: string[] = [];
    for (const tag of folder.autoTags ?? []) {
      const key = tagKey(tag);
      if (done.has(key)) {
        continue;
      }
      if (keys.has(key)) {
        applied.push(key);
        continue;
      }
      if (tags.length >= MAX_CARD_TAGS) {
        break;
      }
      tags.push(tag);
      keys.add(key);
      applied.push(key);
      addedHere.push(tag);
    }
    await recordApplication(ctx, card, folderId, existing, applied);
    if (addedHere.length > 0) {
      added.set(folderId, addedHere);
    }
  }
  return added.size > 0 ? { added, tags } : { added };
};

type RuleMatcher = (card: Doc<"cards">, text: string) => boolean;

/**
 * The text a rule's words are checked against, built the way the card's
 * search document is, from the card as the caller is about to write it. The
 * stored document can trail that write, so it is never read here.
 */
const ruleTextFor = async (
  ctx: QueryCtx,
  card: Doc<"cards">,
  transcript?: string
): Promise<string> =>
  buildCardSearchText(
    card,
    undefined,
    transcript ?? card.aiTranscript ?? (await readCardTranscript(ctx, card))
  );

const buildRuleMatcher = async (
  ctx: QueryCtx,
  userId: string,
  autoFileQuery: string
): Promise<RuleMatcher | null> => {
  const parsed = parseSearchQuery(autoFileQuery);
  if (parsed.similarity) {
    return null;
  }
  const resolved = await resolveSearch(ctx, userId, parsed, {
    archived: "include",
  });
  if (!resolved) {
    return null;
  }
  return (card: Doc<"cards">, text: string): boolean =>
    card.isDeleted !== true &&
    (!parsed.archived || card.isArchived === true) &&
    resolved.matches(card, text) &&
    resolved.matchesWords(text);
};

const activeFilingFolders = async (
  ctx: QueryCtx,
  userId: string
): Promise<Doc<"folders">[]> => {
  const folders: Doc<"folders">[] = [];
  for await (const folder of ctx.db
    .query("folders")
    .withIndex("by_userId_and_hasRules", (q) =>
      q.eq("userId", userId).eq("hasRules", true)
    )) {
    if (
      folder.deletingAt === undefined &&
      folder.kind === "manual" &&
      folder.autoFileQuery !== undefined &&
      folder.autoFilePaused !== true
    ) {
      folders.push(folder);
    }
    if (folders.length >= MAX_FOLDER_RULES) {
      break;
    }
  }
  return folders.sort((a, b) => a.createdAt - b.createdAt);
};

export interface AutoFileResult {
  filedFolderIds: Id<"folders">[];
  folderIds?: Id<"folders">[];
  tags?: string[];
}

/**
 * Files a card into every folder whose auto-file search it matches, then
 * adds those folders' tags. One pass: tags added here don't file the card
 * anywhere else. A folder the rule filed the card into once is never filled
 * again, so a card taken out by hand stays out. `card` is the card as it
 * will be after the caller's own patch; the caller writes the result with it.
 */
export const autoFileCard = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  /** A transcript the caller is writing now, which the card no longer holds. */
  transcript?: string
): Promise<AutoFileResult> => {
  if (card.isDeleted === true) {
    return { filedFolderIds: [] };
  }
  const folders = await activeFilingFolders(ctx, card.userId);
  if (folders.length === 0) {
    return { filedFolderIds: [] };
  }
  const text = await ruleTextFor(ctx, card, transcript);
  const current = card.folderIds ?? [];
  const next = [...current];
  const filedFolderIds: Id<"folders">[] = [];
  for (const folder of folders) {
    if (next.length >= MAX_FOLDERS_PER_CARD) {
      break;
    }
    if (next.includes(folder._id)) {
      continue;
    }
    const existing = await readApplication(ctx, card._id, folder._id);
    if (existing?.filed === true) {
      continue;
    }
    const matcher = await buildRuleMatcher(
      ctx,
      card.userId,
      folder.autoFileQuery ?? ""
    );
    if (!matcher?.(card, text)) {
      continue;
    }
    next.push(folder._id);
    filedFolderIds.push(folder._id);
  }
  if (filedFolderIds.length === 0) {
    return { filedFolderIds };
  }
  const { tags } = await autoTagsForJoinedFolders(ctx, card, next, current);
  return { filedFolderIds, folderIds: next, ...(tags ? { tags } : {}) };
};

/** Runs the auto-file rules on a card already saved, and writes the result. */
export const applyAutoFileRulesToCard = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<Id<"folders">[]> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || (await accountDeletionOwnsRows(ctx, card.userId))) {
    return [];
  }
  const result = await autoFileCard(ctx, card);
  if (!result.folderIds) {
    return [];
  }
  await patchCardWithSearchSync(ctx, card._id, {
    folderIds: result.folderIds,
    ...(result.tags ? { tags: result.tags } : {}),
    updatedAt: Date.now(),
  });
  return result.filedFolderIds;
};

// Rule runs over the existing library.

export const folderRuleRunValidator = v.object({
  _id: v.id("folderRuleRuns"),
  folderId: v.id("folders"),
  status: v.union(
    v.literal("running"),
    v.literal("done"),
    v.literal("undoing"),
    v.literal("undone"),
    v.literal("superseded")
  ),
  filedCount: v.number(),
  taggedCount: v.number(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  canUndo: v.boolean(),
});

export interface FolderRuleRunSummary {
  _id: Id<"folderRuleRuns">;
  canUndo: boolean;
  completedAt?: number;
  createdAt: number;
  filedCount: number;
  folderId: Id<"folders">;
  status: Doc<"folderRuleRuns">["status"];
  taggedCount: number;
}

const canUndoRun = (run: Doc<"folderRuleRuns">, now: number) =>
  (run.status === "done" || run.status === "superseded") &&
  run.filedCount + run.taggedCount > 0 &&
  now < run.expiresAt;

export const toFolderRuleRunSummary = (
  run: Doc<"folderRuleRuns">,
  now = Date.now()
): FolderRuleRunSummary => ({
  _id: run._id,
  folderId: run.folderId,
  status: run.status,
  filedCount: run.filedCount,
  taggedCount: run.taggedCount,
  createdAt: run.createdAt,
  ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
  canUndo: canUndoRun(run, now),
});

/**
 * Starts a pass of the folder's rules over the library, ending any pass
 * still running for it. The new pass first tags the cards already in the
 * folder, then files the cards that match its search.
 */
export const startFolderRuleRun = async (
  ctx: MutationCtx,
  folder: Doc<"folders">,
  requested: { runFile: boolean; runTags: boolean }
): Promise<Id<"folderRuleRuns"> | undefined> => {
  let plan = requested;
  if (!(plan.runFile || plan.runTags)) {
    return undefined;
  }
  const now = Date.now();
  if (folder.ruleRunId) {
    const previous = await ctx.db.get("folderRuleRuns", folder.ruleRunId);
    if (previous?.status === "running") {
      await ctx.db.patch("folderRuleRuns", previous._id, {
        status: "superseded",
        cursor: undefined,
        updatedAt: now,
        completedAt: now,
      });
      // The run it replaces may not have finished: run whatever it still had
      // to do, with the folder's rules as they are now.
      plan = {
        runTags:
          plan.runTags ||
          (previous.phase === "tag" && (folder.autoTags?.length ?? 0) > 0),
        runFile:
          plan.runFile ||
          (folder.autoFileQuery !== undefined &&
            folder.autoFilePaused !== true),
      };
    }
  }
  const runId = await ctx.db.insert("folderRuleRuns", {
    userId: folder.userId,
    folderId: folder._id,
    status: "running",
    phase: plan.runTags ? "tag" : "file",
    filedCount: 0,
    taggedCount: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + FOLDER_RULE_RUN_UNDO_MS,
  });
  await ctx.db.patch("folders", folder._id, { ruleRunId: runId });
  await ctx.scheduler.runAfter(0, internal.folder.rules.runFolderRuleBatch, {
    runId,
    fileAfterTags: plan.runFile,
  });
  return runId;
};

const recordRunChange = async (
  ctx: MutationCtx,
  run: Doc<"folderRuleRuns">,
  cardId: Id<"cards">,
  change: { addedTags: string[]; filed: boolean }
) => {
  await ctx.db.insert("folderRuleRunChanges", {
    runId: run._id,
    userId: run.userId,
    cardId,
    ...(change.filed ? { filed: true as const } : {}),
    addedTags: change.addedTags,
  });
};

const finishRun = async (
  ctx: MutationCtx,
  run: Doc<"folderRuleRuns">,
  counts: { filed: number; tagged: number },
  status: "done" | "undone"
) => {
  const now = Date.now();
  await ctx.db.patch("folderRuleRuns", run._id, {
    status,
    cursor: undefined,
    filedCount: run.filedCount + counts.filed,
    taggedCount: run.taggedCount + counts.tagged,
    updatedAt: now,
    completedAt: now,
  });
};

export const runFolderRuleBatchHandler = async (
  ctx: MutationCtx,
  runId: Id<"folderRuleRuns">,
  fileAfterTags: boolean
): Promise<{ done: boolean }> => {
  const run = await ctx.db.get("folderRuleRuns", runId);
  if (run?.status !== "running") {
    return { done: true };
  }
  const folder = await ctx.db.get("folders", run.folderId);
  if (
    !folder ||
    folder.deletingAt !== undefined ||
    folder.ruleRunId !== runId ||
    (await accountDeletionOwnsRows(ctx, run.userId))
  ) {
    await ctx.db.patch("folderRuleRuns", runId, {
      status: "superseded",
      cursor: undefined,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    return { done: true };
  }
  const now = Date.now();
  let filed = 0;
  let tagged = 0;
  let isDone: boolean;
  let continueCursor: string;

  if (run.phase === "tag") {
    const page = await ctx.db
      .query("folderCards")
      .withIndex(
        "by_folderId_and_isDeleted_and_isArchived_and_cardSavedAt",
        (q) => q.eq("folderId", folder._id)
      )
      .paginate({
        numItems: FOLDER_RULE_BATCH_SIZE,
        cursor: run.cursor ?? null,
      });
    for (const row of page.page) {
      if (row.isDeleted === true) {
        continue;
      }
      const card = await ctx.db.get("cards", row.cardId);
      if (!card || card.isDeleted === true || card.userId !== run.userId) {
        continue;
      }
      // Tag the card as if it joined the folder now.
      const result = await autoTagsForJoinedFolders(
        ctx,
        card,
        [folder._id],
        []
      );
      const addedTags = result.added.get(folder._id) ?? [];
      if (result.tags && addedTags.length > 0) {
        await patchCardWithSearchSync(ctx, card._id, {
          tags: result.tags,
          updatedAt: now,
        });
        await recordRunChange(ctx, run, card._id, { addedTags, filed: false });
        tagged += 1;
      }
    }
    ({ isDone, continueCursor } = page);
    if (isDone && fileAfterTags && folder.autoFileQuery !== undefined) {
      await ctx.db.patch("folderRuleRuns", runId, {
        phase: "file",
        cursor: undefined,
        filedCount: run.filedCount + filed,
        taggedCount: run.taggedCount + tagged,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.folder.rules.runFolderRuleBatch,
        { runId, fileAfterTags }
      );
      return { done: false };
    }
  } else {
    const matches =
      folder.autoFileQuery !== undefined && folder.autoFilePaused !== true
        ? await buildRuleMatcher(ctx, run.userId, folder.autoFileQuery)
        : null;
    if (!matches) {
      await finishRun(ctx, run, { filed, tagged }, "done");
      return { done: true };
    }
    const page: PaginationResult<Doc<"cards">> = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_created", (q) => q.eq("userId", run.userId))
      .paginate({
        numItems: FOLDER_RULE_BATCH_SIZE,
        cursor: run.cursor ?? null,
      });
    for (const card of page.page) {
      const current = card.folderIds ?? [];
      if (
        card.isDeleted === true ||
        current.includes(folder._id) ||
        current.length >= MAX_FOLDERS_PER_CARD ||
        !matches(card, await ruleTextFor(ctx, card))
      ) {
        continue;
      }
      const existing = await readApplication(ctx, card._id, folder._id);
      if (existing?.filed === true) {
        continue;
      }
      const next = [...current, folder._id];
      const result = await autoTagsForJoinedFolders(ctx, card, next, current);
      const addedTags = result.added.get(folder._id) ?? [];
      await patchCardWithSearchSync(ctx, card._id, {
        folderIds: next,
        ...(result.tags ? { tags: result.tags } : {}),
        updatedAt: now,
      });
      await recordRunChange(ctx, run, card._id, { addedTags, filed: true });
      filed += 1;
      if (addedTags.length > 0) {
        tagged += 1;
      }
    }
    ({ isDone, continueCursor } = page);
  }

  if (isDone) {
    await finishRun(ctx, run, { filed, tagged }, "done");
    return { done: true };
  }
  await ctx.db.patch("folderRuleRuns", runId, {
    cursor: continueCursor,
    filedCount: run.filedCount + filed,
    taggedCount: run.taggedCount + tagged,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.folder.rules.runFolderRuleBatch, {
    runId,
    fileAfterTags,
  });
  return { done: false };
};

export const runFolderRuleBatch = internalMutation({
  args: { runId: v.id("folderRuleRuns"), fileAfterTags: v.boolean() },
  returns: v.object({ done: v.boolean() }),
  handler: (ctx, { runId, fileAfterTags }) =>
    runFolderRuleBatchHandler(ctx, runId, fileAfterTags),
});

const runNotFound = () =>
  new ConvexError({
    code: "NOT_FOUND",
    message: FOLDER_ERROR_MESSAGES.RULE_RUN_NOT_FOUND,
  });

const requireRunForUser = async (
  ctx: QueryCtx,
  userId: string,
  folderId: string,
  runId: string
): Promise<Doc<"folderRuleRuns">> => {
  const id = ctx.db.normalizeId("folderRuleRuns", runId);
  const run = id ? await ctx.db.get("folderRuleRuns", id) : null;
  if (!run || run.userId !== userId || run.folderId !== folderId) {
    throw runNotFound();
  }
  return run;
};

export const getFolderRuleRunForUser = async (
  ctx: QueryCtx,
  userId: string,
  folderId: string,
  runId: string
): Promise<FolderRuleRunSummary> =>
  toFolderRuleRunSummary(await requireRunForUser(ctx, userId, folderId, runId));

/**
 * Takes back what one run did: the folder from the cards it filed, if they
 * are still in it, and the tags it added, if they are still on them. The
 * folder's rules don't change, and the cards count as taken out by hand, so
 * the rules never put them back.
 */
export const undoFolderRuleRunForUser = async (
  ctx: MutationCtx,
  userId: string,
  folderId: string,
  runId: string
): Promise<FolderRuleRunSummary> => {
  const run = await requireRunForUser(ctx, userId, folderId, runId);
  if (run.status === "undoing" || run.status === "undone") {
    return toFolderRuleRunSummary(run);
  }
  const now = Date.now();
  // A pass still running stops where it is: the batch sees the new status.
  if (run.status !== "running" && now >= run.expiresAt) {
    throw new ConvexError({
      code: "CONFLICT",
      message: FOLDER_ERROR_MESSAGES.RULE_RUN_EXPIRED,
    });
  }
  await ctx.db.patch("folderRuleRuns", run._id, {
    status: "undoing",
    phase: "undo",
    cursor: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.folder.rules.undoFolderRuleBatch, {
    runId: run._id,
  });
  const updated = await ctx.db.get("folderRuleRuns", run._id);
  if (!updated) {
    throw runNotFound();
  }
  return toFolderRuleRunSummary(updated, now);
};

export const undoFolderRuleBatchHandler = async (
  ctx: MutationCtx,
  runId: Id<"folderRuleRuns">
): Promise<{ done: boolean }> => {
  const run = await ctx.db.get("folderRuleRuns", runId);
  if (run?.status !== "undoing") {
    return { done: true };
  }
  if (await accountDeletionOwnsRows(ctx, run.userId)) {
    return { done: true };
  }
  const changes = await ctx.db
    .query("folderRuleRunChanges")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .take(FOLDER_RULE_BATCH_SIZE);
  const now = Date.now();
  for (const change of changes) {
    await ctx.db.delete("folderRuleRunChanges", change._id);
    const card = await ctx.db.get("cards", change.cardId);
    if (!card || card.userId !== run.userId) {
      continue;
    }
    const removeKeys = new Set(change.addedTags.map(tagKey));
    const tags = (card.tags ?? []).filter(
      (tag) => !removeKeys.has(tagKey(tag))
    );
    const folderIds = change.filed
      ? (card.folderIds ?? []).filter((id) => id !== run.folderId)
      : (card.folderIds ?? []);
    const tagsChanged = tags.length !== (card.tags ?? []).length;
    const foldersChanged = folderIds.length !== (card.folderIds ?? []).length;
    if (tagsChanged || foldersChanged) {
      await patchCardWithSearchSync(ctx, card._id, {
        ...(tagsChanged ? { tags: tags.length > 0 ? tags : undefined } : {}),
        ...(foldersChanged
          ? { folderIds: folderIds.length > 0 ? folderIds : undefined }
          : {}),
        updatedAt: now,
      });
    }
  }
  if (changes.length < FOLDER_RULE_BATCH_SIZE) {
    await ctx.db.patch("folderRuleRuns", runId, {
      status: "undone",
      updatedAt: now,
      completedAt: now,
    });
    return { done: true };
  }
  await ctx.scheduler.runAfter(0, internal.folder.rules.undoFolderRuleBatch, {
    runId,
  });
  return { done: false };
};

export const undoFolderRuleBatch = internalMutation({
  args: { runId: v.id("folderRuleRuns") },
  returns: v.object({ done: v.boolean() }),
  handler: (ctx, { runId }) => undoFolderRuleBatchHandler(ctx, runId),
});

// Cleanup.

export const FOLDER_RULE_CLEANUP_BATCH_SIZE = 100;

/** Deletes a folder's rule records, a batch at a time. True when none are left. */
export const deleteFolderRuleRows = async (
  ctx: MutationCtx,
  folderId: Id<"folders">
): Promise<boolean> => {
  const applications = await ctx.db
    .query("folderRuleApplications")
    .withIndex("by_folderId", (q) => q.eq("folderId", folderId))
    .take(FOLDER_RULE_CLEANUP_BATCH_SIZE);
  for (const row of applications) {
    await ctx.db.delete("folderRuleApplications", row._id);
  }
  if (applications.length === FOLDER_RULE_CLEANUP_BATCH_SIZE) {
    return false;
  }
  const runs = await ctx.db
    .query("folderRuleRuns")
    .withIndex("by_folderId_and_createdAt", (q) => q.eq("folderId", folderId))
    .take(10);
  for (const run of runs) {
    const changes = await ctx.db
      .query("folderRuleRunChanges")
      .withIndex("by_runId", (q) => q.eq("runId", run._id))
      .take(FOLDER_RULE_CLEANUP_BATCH_SIZE);
    for (const change of changes) {
      await ctx.db.delete("folderRuleRunChanges", change._id);
    }
    if (changes.length === FOLDER_RULE_CLEANUP_BATCH_SIZE) {
      return false;
    }
    await ctx.db.delete("folderRuleRuns", run._id);
  }
  return runs.length < 10;
};

/** Deletes one card's rule records, for a card deleted for good. */
export const deleteCardFolderRuleRows = async (
  ctx: MutationCtx,
  cardId: Id<"cards">
): Promise<void> => {
  const applications = await ctx.db
    .query("folderRuleApplications")
    .withIndex("by_cardId_and_folderId", (q) => q.eq("cardId", cardId))
    .take(FOLDER_RULE_CLEANUP_BATCH_SIZE);
  for (const row of applications) {
    await ctx.db.delete("folderRuleApplications", row._id);
  }
  const changes = await ctx.db
    .query("folderRuleRunChanges")
    .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
    .take(FOLDER_RULE_CLEANUP_BATCH_SIZE);
  for (const row of changes) {
    await ctx.db.delete("folderRuleRunChanges", row._id);
  }
  // A card can collect rows from folders it joined and left over time: the
  // rest go in batches of their own.
  if (
    applications.length === FOLDER_RULE_CLEANUP_BATCH_SIZE ||
    changes.length === FOLDER_RULE_CLEANUP_BATCH_SIZE
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.folder.rules.deleteCardFolderRuleRowsBatch,
      { cardId }
    );
  }
};

export const deleteCardFolderRuleRowsBatch = internalMutation({
  args: { cardId: v.id("cards") },
  returns: v.null(),
  handler: async (ctx, { cardId }) => {
    await deleteCardFolderRuleRows(ctx, cardId);
    return null;
  },
});

/** Deletes rule runs past their undo window, with their changes. */
export const deleteExpiredFolderRuleRuns = internalMutation({
  args: {},
  returns: v.object({ done: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const runs = await ctx.db
      .query("folderRuleRuns")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(10);
    // A run still running or undoing a day on is stuck; its batch, if one
    // is still scheduled, stops once the run is gone. Every run here loses
    // rows, so the loop always moves on.
    for (const run of runs) {
      const changes = await ctx.db
        .query("folderRuleRunChanges")
        .withIndex("by_runId", (q) => q.eq("runId", run._id))
        .take(FOLDER_RULE_CLEANUP_BATCH_SIZE);
      for (const change of changes) {
        await ctx.db.delete("folderRuleRunChanges", change._id);
      }
      if (changes.length < FOLDER_RULE_CLEANUP_BATCH_SIZE) {
        await ctx.db.delete("folderRuleRuns", run._id);
      }
    }
    const more = runs.length === 10;
    if (more) {
      await ctx.scheduler.runAfter(
        0,
        internal.folder.rules.deleteExpiredFolderRuleRuns,
        {}
      );
    }
    return { done: !more };
  },
});

// Public functions for the web app.

export const getFolderRuleRun = query({
  args: { folderId: v.id("folders"), runId: v.id("folderRuleRuns") },
  returns: v.union(folderRuleRunValidator, v.null()),
  handler: async (ctx, { folderId, runId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const run = await ctx.db.get("folderRuleRuns", runId);
    return run && run.userId === user.teakUserId && run.folderId === folderId
      ? toFolderRuleRunSummary(run)
      : null;
  },
});

export const undoFolderRuleRun = mutation({
  args: { folderId: v.id("folders"), runId: v.id("folderRuleRuns") },
  returns: folderRuleRunValidator,
  handler: async (ctx, { folderId, runId }) => {
    const userId = await requireSessionUserId(ctx);
    await requireFolderForUser(ctx, userId, folderId);
    return undoFolderRuleRunForUser(ctx, userId, folderId, runId);
  },
});
