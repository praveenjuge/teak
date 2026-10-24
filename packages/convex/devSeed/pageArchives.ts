import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type MutationCtx } from "../_generated/server";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { stageFailed, stagePending } from "../card/processingStatus";
import { PAGE_ARCHIVE_ROLE } from "../shared/pageArchive";
import { putObjectViaFilesWorker } from "../storage/filesWorkerClient";
import { registerOwnedObject } from "../storage/ownership";
import { buildR2ObjectKey } from "../storage/r2";
import { SCENARIO_MARKER } from "./helpers";

/**
 * Seed packs for links' saved copies of their pages: every state the side
 * panel and the dead-link fallback show, and a library to backfill.
 */

export const PAGE_ARCHIVE_MIX_TAG = "scenario-page-archives";
const CAPTURED_AT = Date.UTC(2026, 9, 19, 9);

const markedUrl = (slug: string) =>
  `https://example.com/page-archives/${slug}#${SCENARIO_MARKER}-page-archives`;

type ArchiveSetup =
  | {
      kind: "full" | "text_only";
      /** The stub object written to R2. */
      stub: "full" | "text_only";
      source: "extension" | "server";
    }
  | { failed: "blocked_url" | "too_large" }
  | { pending: true };

interface PageArchiveMixCard {
  card: DevScenarioCardDef;
  setup: ArchiveSetup;
  slug: string;
}

const mixCard = (
  slug: string,
  title: string,
  setup: ArchiveSetup,
  extra: Partial<DevScenarioCardDef> = {}
): PageArchiveMixCard => ({
  card: {
    content: markedUrl(slug),
    metadataTitle: title,
    tags: [PAGE_ARCHIVE_MIX_TAG],
    type: "link",
    url: markedUrl(slug),
    ...extra,
  },
  setup,
  slug,
});

export const PAGE_ARCHIVE_MIX: PageArchiveMixCard[] = [
  mixCard("full", "A full copy, 40 KB with its images inlined", {
    kind: "full",
    source: "server",
    stub: "full",
  }),
  mixCard("text-only", "A page too large to keep whole", {
    kind: "text_only",
    source: "server",
    stub: "text_only",
  }),
  mixCard("blocked", "A page Teak can't open", { failed: "blocked_url" }),
  mixCard("too-large", "A page too large to fetch", { failed: "too_large" }),
  mixCard("pending", "A copy still being saved", { pending: true }),
  mixCard("extension", "Saved from the extension, signed in", {
    kind: "full",
    source: "extension",
    stub: "full",
  }),
  mixCard(
    "trashed",
    "In Trash, with its copy",
    { kind: "full", source: "server", stub: "full" },
    { isDeleted: true }
  ),
  mixCard(
    "podcast",
    "Episode 7: A podcast with its copy and transcript",
    { kind: "full", source: "server", stub: "full" },
    {
      aiTranscript:
        "Welcome to episode seven. Today we talk about keeping copies of the pages we love.",
      metadata: {
        linkCategory: {
          category: "podcast",
          fetchedAt: CAPTURED_AT,
          sourceUrl: markedUrl("podcast"),
        },
      },
    }
  ),
];

/** A 40 KB page with inline SVG images, as the inliner would write it. */
export const stubArchiveHtml = (
  kind: "full" | "text_only",
  url: string
): string => {
  const header = `<meta charset="utf-8"><meta name="teak-archive" content="${JSON.stringify(
    { capturedAt: CAPTURED_AT, source: "server", url }
  ).replaceAll(
    '"',
    "&quot;"
  )}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src 'none'">`;
  if (kind === "text_only") {
    return `<!doctype html><html lang="en"><head>${header}<title>A long page</title></head><body><header><p>Text-only copy</p></header><h1>A long page</h1>${"<p>Only the words of this page were kept, because the whole page was too large.</p>".repeat(40)}</body></html>`;
  }
  const image = (hue: number) =>
    `<img alt="Swatch ${hue}" width="160" height="90" src="data:image/svg+xml;base64,${btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="hsl(${hue} 60% 55%)"/><text x="12" y="50" font-size="18" fill="white">${"Teak ".repeat(200)}</text></svg>`
    )}">`;
  const images = Array.from({ length: 24 }, (_, index) => image(index * 15));
  return `<!doctype html><html lang="en"><head>${header}<title>A saved page</title><style>body{font:16px/1.6 Georgia,serif;max-width:40rem;margin:2rem auto;color:#222}img{border-radius:6px;margin:4px}</style></head><body><h1>A saved page</h1><p>This copy carries its styles and images inside the file.</p>${images.join("")}<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">The original site</a></p></body></html>`;
};

const archiveKey = (userId: string, cardId: Id<"cards">) =>
  buildR2ObjectKey({
    userId,
    cardId,
    role: PAGE_ARCHIVE_ROLE,
    objectId: "r0",
    fileName: "archive.html",
  });

/**
 * Inserts the mix's cards, gives each its archive state, and schedules the
 * stub objects' upload. Seeded once: the first card's URL marks the pack.
 */
export const seedPageArchiveMix = async (
  ctx: MutationCtx,
  userId: string
): Promise<{ cards: number; status: "already_seeded" | "seeded" }> => {
  const first = PAGE_ARCHIVE_MIX[0]?.card.url;
  const seeded = first
    ? await ctx.db
        .query("cards")
        .withIndex("by_user_url_deleted", (q) =>
          q.eq("userId", userId).eq("url", first)
        )
        .first()
    : null;
  if (seeded) {
    return { cards: 0, status: "already_seeded" };
  }
  const ids = await insertCompletedCards(
    ctx,
    userId,
    PAGE_ARCHIVE_MIX.map(({ card }) => card),
    { ignoreCardLimit: true }
  );
  const stubs: Array<{ key: string; kind: "full" | "text_only"; url: string }> =
    [];
  for (const [index, entry] of PAGE_ARCHIVE_MIX.entries()) {
    const cardId = ids[index] as Id<"cards">;
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      continue;
    }
    const stages = card.processingStatus ?? {};
    const { setup } = entry;
    if ("pending" in setup) {
      await ctx.db.patch("cards", cardId, {
        processingStatus: { ...stages, archive: stagePending() },
      });
    } else if ("failed" in setup) {
      await ctx.db.patch("cards", cardId, {
        processingStatus: {
          ...stages,
          archive: stageFailed(CAPTURED_AT, setup.failed),
        },
      });
    } else {
      const key = archiveKey(userId, cardId);
      const html = stubArchiveHtml(setup.stub, entry.card.url as string);
      if (await registerOwnedObject(ctx, userId, key)) {
        stubs.push({ key, kind: setup.stub, url: entry.card.url as string });
      }
      await ctx.db.patch("cards", cardId, {
        pageArchive: {
          bytes: new TextEncoder().encode(html).byteLength,
          capturedAt: CAPTURED_AT,
          kind: setup.kind,
          source: setup.source,
          sourceUrl: entry.card.url as string,
          storageKey: key,
        },
        processingStatus: {
          ...stages,
          archive: { completedAt: CAPTURED_AT, status: "completed" },
        },
      });
    }
  }
  if (stubs.length > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.devSeed.pageArchives.writeStubArchives,
      { stubs }
    );
  }
  return { cards: ids.length, status: "seeded" };
};

/** Writes the mix's stub archives to R2 through the Files Worker. */
export const writeStubArchives = internalAction({
  args: {
    stubs: v.array(
      v.object({
        key: v.string(),
        kind: v.union(v.literal("full"), v.literal("text_only")),
        url: v.string(),
      })
    ),
  },
  returns: v.null(),
  handler: async (_ctx, { stubs }) => {
    for (const stub of stubs) {
      await putObjectViaFilesWorker({
        body: new TextEncoder().encode(stubArchiveHtml(stub.kind, stub.url)),
        contentType: "text/html",
        key: stub.key,
      });
    }
    return null;
  },
});

export const ARCHIVE_BACKFILL_SIZE = 1000;
export const ARCHIVE_BACKFILL_PAGE_SIZE = 200;
const BACKFILL_START = Date.UTC(2024, 0, 1);

/** 1,000 processed links without a saved copy, for the backfill. */
export const archiveBackfillScenarioPage = (
  page: number
): DevScenarioCardDef[] =>
  Array.from({ length: ARCHIVE_BACKFILL_PAGE_SIZE }, (_, offset) => {
    const index = page * ARCHIVE_BACKFILL_PAGE_SIZE + offset;
    const url = `https://example.com/archive-backfill/${index}#${SCENARIO_MARKER}-archive-backfill`;
    return {
      content: url,
      createdAt: BACKFILL_START + index * 3_600_000,
      metadataTitle: `Link ${index + 1} to archive`,
      tags: ["scenario-archive-backfill"],
      type: "link" as const,
      url,
    };
  }).filter(
    (_card, offset) =>
      page * ARCHIVE_BACKFILL_PAGE_SIZE + offset < ARCHIVE_BACKFILL_SIZE
  );
