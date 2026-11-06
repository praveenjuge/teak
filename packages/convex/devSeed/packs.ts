import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DevScenarioCardDef } from "../card/defaultCards";
import { insertFolder, readLiveFolders } from "../folder/folders";
import { startFolderRuleRun } from "../folder/rules";
import { folderNameKey, MAX_FOLDERS_PER_USER } from "../shared/folders";
import { parseSearchQuery } from "../shared/search/qualifiers";
import type { FolderScenarioPack } from "./folderPacks";
import { insertSeedCards, type SeedCardDef } from "./helpers";

export interface SeedResult {
  cards: number;
  folders?: number;
  status: "already_seeded" | "seeded";
}

export interface SeedOptions {
  /** A server answering `/status/<code>` and `/delay/<s>` (dead-links). */
  origin?: string;
  /** Large packs seed 200 cards a page, from 0 until `already_seeded`. */
  page: number;
}

/**
 * One dev seed pack. `devSeed:seedScenario` finds a pack by name and calls
 * its `seed`; nothing else about a pack is special-cased.
 */
export interface ScenarioPack {
  description: string;
  name: string;
  seed: (
    ctx: MutationCtx,
    userId: string,
    options: SeedOptions
  ) => Promise<SeedResult>;
}

const ALREADY_SEEDED: SeedResult = { status: "already_seeded", cards: 0 };

export const firstPageOnly =
  (cards: readonly SeedCardDef[]) =>
  (page: number): readonly SeedCardDef[] =>
    page === 0 ? cards : [];

/**
 * A pack of cards, one page at a time. A page whose first link is already
 * saved counts as seeded, so seeding twice adds nothing.
 */
export const cardsPack = (
  name: string,
  description: string,
  cards: (page: number) => readonly SeedCardDef[]
): ScenarioPack => ({
  name,
  description,
  seed: async (ctx, userId, { page }) => {
    const pageCards = cards(page);
    if (pageCards.length === 0) {
      return ALREADY_SEEDED;
    }
    const marker = pageCards.find((card) => card.url)?.url;
    const existing = marker
      ? await ctx.db
          .query("cards")
          .withIndex("by_user_url_deleted", (q) =>
            q.eq("userId", userId).eq("url", marker)
          )
          .first()
      : null;
    if (existing) {
      return ALREADY_SEEDED;
    }
    await insertSeedCards(ctx, userId, pageCards);
    return { status: "seeded", cards: pageCards.length };
  },
});

const seedFolderScenario = async (
  ctx: MutationCtx,
  userId: string,
  pack: FolderScenarioPack
): Promise<SeedResult> => {
  const existing = await readLiveFolders(ctx, userId);
  const byKey = new Map<string, Id<"folders">>();
  for (const folder of existing) {
    byKey.set(folder.nameKey, folder._id);
  }
  let total = existing.length;
  let created = 0;
  const now = Date.now();
  const folderIds: (Id<"folders"> | undefined)[] = [];
  const rulesToRun: Id<"folders">[] = [];
  for (const [index, folder] of pack.folders.entries()) {
    const key = folderNameKey(folder.name);
    let folderId = byKey.get(key);
    if (!folderId && total < MAX_FOLDERS_PER_USER) {
      folderId = await insertFolder(
        ctx,
        userId,
        folder.name.trim(),
        folder.color,
        now + index,
        folder.query === undefined
          ? undefined
          : parseSearchQuery(folder.query).canonical
      );
      const rules = {
        ...(folder.autoTags ? { autoTags: folder.autoTags } : {}),
        ...(folder.autoFileQuery === undefined
          ? {}
          : {
              autoFileQuery: parseSearchQuery(folder.autoFileQuery).canonical,
            }),
        ...(folder.autoFilePaused ? { autoFilePaused: true as const } : {}),
      };
      if (Object.keys(rules).length > 0) {
        await ctx.db.patch("folders", folderId, {
          ...rules,
          hasRules: true,
        });
        // Run the rules as saving them does, once the pack's cards exist.
        rulesToRun.push(folderId);
      }
      byKey.set(key, folderId);
      total += 1;
      created += 1;
    }
    folderIds.push(folderId);
  }

  const marker = pack.cards[0]?.url;
  const seeded = marker
    ? await ctx.db
        .query("cards")
        .withIndex("by_user_url_deleted", (q) =>
          q.eq("userId", userId).eq("url", marker)
        )
        .first()
    : null;
  const cards: DevScenarioCardDef[] = seeded
    ? []
    : pack.cards.map(({ folders, ...card }) => ({
        ...card,
        folderIds: Array.from(
          new Set(
            folders
              .map((place) => folderIds[place])
              .filter((id): id is Id<"folders"> => id !== undefined)
          )
        ),
      }));
  if (cards.length > 0) {
    await insertSeedCards(ctx, userId, cards);
  }
  for (const folderId of rulesToRun) {
    const folder = await ctx.db.get("folders", folderId);
    if (folder) {
      await startFolderRuleRun(ctx, folder, {
        runTags: (folder.autoTags?.length ?? 0) > 0,
        runFile:
          folder.autoFileQuery !== undefined && folder.autoFilePaused !== true,
      });
    }
  }
  return {
    status: cards.length > 0 || created > 0 ? "seeded" : "already_seeded",
    cards: cards.length,
    folders: created,
  };
};

/**
 * A pack of folders and the cards filed in them. `before` runs first, for
 * account settings the pack needs (Save by email turned on).
 */
export const folderPack = (
  name: string,
  description: string,
  pack: () => FolderScenarioPack,
  before?: (ctx: MutationCtx, userId: string) => Promise<void>
): ScenarioPack => ({
  name,
  description,
  seed: async (ctx, userId) => {
    await before?.(ctx, userId);
    return await seedFolderScenario(ctx, userId, pack());
  },
});

const FILL_START = Date.UTC(2025, 0, 1);

/**
 * Fills the library to `fillTo` active cards with filler notes, after any
 * `lead` cards not saved yet.
 */
export const fillPack = (
  name: string,
  description: string,
  fillTo: number,
  lead: readonly SeedCardDef[] = []
): ScenarioPack => ({
  name,
  description,
  seed: async (ctx, userId) => {
    const active = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_saved", (q) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .take(fillTo);
    const missingLead: SeedCardDef[] = [];
    for (const card of lead) {
      const saved = card.url
        ? await ctx.db
            .query("cards")
            .withIndex("by_user_url_deleted", (q) =>
              q.eq("userId", userId).eq("url", card.url)
            )
            .first()
        : null;
      if (!saved) {
        missingLead.push(card);
      }
    }
    const filler: SeedCardDef[] = [
      ...missingLead,
      ...Array.from(
        {
          length: Math.max(0, fillTo - active.length - missingLead.length),
        },
        (_, index): SeedCardDef => ({
          type: "text",
          content: `Filler card ${index + 1}`,
          createdAt: FILL_START + index * 60_000,
          tags: ["scenario-card-limit"],
        })
      ),
    ];
    if (filler.length === 0) {
      return ALREADY_SEEDED;
    }
    await insertSeedCards(ctx, userId, filler);
    return { status: "seeded", cards: filler.length };
  },
});
