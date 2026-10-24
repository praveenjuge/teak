import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { saveArticleTextHandler } from "../card/articleText";
import {
  type DevScenarioCardDef,
  insertCompletedCards,
} from "../card/defaultCards";
import { searchPrefix } from "../card/documentTextFormat";
import {
  stageCompleted,
  stageFailed,
  stagePending,
} from "../card/processingStatus";
import {
  articleImageObjectKey,
  articlePlainText,
  articleTextObjectKey,
  countWords,
  readingMinutes,
} from "../shared/article";
import { PAGE_ARCHIVE_ROLE } from "../shared/pageArchive";
import { codePointLength } from "../shared/utils/codePoints";
import { putObjectViaFilesWorker } from "../storage/filesWorkerClient";
import { registerOwnedObject } from "../storage/ownership";
import { buildR2ObjectKey, buildR2UserPrefix } from "../storage/r2";
import { sha256Hex } from "../storage/r2Keys";
import { SCENARIO_MARKER } from "./helpers";
import { stubArchiveHtml } from "./pageArchives";

/**
 * Seed packs for the Read tab: articles in every state the reader shows, and
 * a library whose articles only their body text can find.
 */

export const READER_MIX_TAG = "scenario-reader";
const CAPTURED_AT = Date.UTC(2026, 9, 19, 9);

const markedUrl = (slug: string) =>
  `https://example.com/reader/${slug}#${SCENARIO_MARKER}-reader`;

/** A small picture, drawn rather than fetched. */
const svgImage = (hue: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="hsl(${hue} 55% 55%)"/><text x="60" y="360" font-family="sans-serif" font-size="64" fill="white">${label}</text></svg>`;

const paragraph = (index: number, topic: string) =>
  `Paragraph ${index + 1} on ${topic}: a garden rewards the patience of whoever tends it, season after season, and the notes kept along the way become the best guide to the next planting. Soil, light and water each ask for attention, and the gardener who writes things down learns which of them matters most in their own plot.`;

/** A 3,000-word article with images, code, a table and a blockquote. */
const longForm = (): string => {
  const parts = [
    "# The patient garden",
    "",
    "Gardening is mostly waiting, and the waiting is the point.",
  ];
  for (let index = 0; index < 50; index += 1) {
    if (index === 4) {
      parts.push('![Rows of tulips in spring](teak-image:0 "Tulips in April")');
    }
    if (index === 12) {
      parts.push(
        "## Planting calendar",
        "",
        "| Plant | Sow | Harvest |",
        "| --- | --- | --- |",
        "| Tomato | March | August |",
        "| Garlic | October | July |",
        "| A plant with a very long name that makes the table wider than a phone | May | September |"
      );
    }
    if (index === 20) {
      parts.push(
        "> The best time to plant a tree was twenty years ago. The second best time is now."
      );
    }
    if (index === 28) {
      parts.push(
        "## Watering by the numbers",
        "",
        "```ts",
        "const litresPerWeek = (area: number, rain: number) =>",
        "  Math.max(0, area * 25 - rain);",
        "```"
      );
    }
    if (index === 36) {
      parts.push("![A watering can on a path](teak-image:1)");
    }
    if (index === 44) {
      parts.push(
        "A link inside a paragraph stays on one line until it can't: https://example.com/a/very/long/address/that/keeps/going/without/any/spaces/at/all/for/the/narrow/screen."
      );
    }
    parts.push(paragraph(index, "the patient garden"));
  }
  parts.push('![Seeds drying on a cloth](teak-image:2 "Saved seeds")');
  return parts.join("\n\n");
};

const NEWS = [
  "City opens three new community gardens",
  "",
  "The council opened three community gardens on Saturday, adding 120 plots for residents on the waiting list.",
  "",
  ...Array.from({ length: 12 }, (_, index) => paragraph(index, "the gardens")),
].join("\n\n");

const RESEARCH = [
  "## Abstract",
  "",
  "We measure how mulch depth changes soil moisture across 48 plots over two growing seasons. Plots with 8 cm of mulch kept 31% more moisture in July than bare plots, with no change in yield. We discuss what this means for gardens in dry summers and how the effect varies with soil type, slope and the kind of mulch used.",
  "",
  "**Keywords:** mulch, soil moisture, drought",
].join("\n\n");

const TEXT_ONLY = Array.from({ length: 18 }, (_, index) =>
  paragraph(index, "a page kept as text")
).join("\n\n");

const ARABIC = Array.from(
  { length: 30 },
  (_, index) =>
    `الفقرة ${index + 1}: الحديقة تكافئ صبر من يعتني بها موسماً بعد موسم، والملاحظات التي يكتبها البستاني تصبح أفضل دليل للزراعة القادمة.`
).join("\n\n");

const JAPANESE = Array.from(
  { length: 30 },
  (_, index) =>
    `第${index + 1}段落：庭は手をかける人の忍耐に季節ごとに応えてくれます。書き留めたメモが、次の植え付けのいちばんの手引きになります。`
).join("\n\n");

const PODCAST = Array.from({ length: 10 }, (_, index) =>
  paragraph(index, "this episode's show notes")
).join("\n\n");

/** About 512 KiB characters, cut like a real article past the cap. */
const truncated = (): string =>
  Array.from({ length: 1560 }, (_, index) =>
    paragraph(index, "a very long page")
  ).join("\n\n");

type ReaderSetup =
  | {
      images?: number;
      lang?: string;
      markdown: () => string;
      ready: true;
      textOnly?: true;
      truncated?: true;
    }
  | { none: true }
  | { stage: "pending" | "failed" };

interface ReaderMixCard {
  byline?: string;
  card: DevScenarioCardDef;
  setup: ReaderSetup;
}

const readerCard = (
  slug: string,
  title: string,
  category: string,
  setup: ReaderSetup,
  extra: Partial<DevScenarioCardDef> & { byline?: string } = {}
): ReaderMixCard => {
  const { byline, ...fields } = extra;
  return {
    ...(byline ? { byline } : {}),
    card: {
      content: markedUrl(slug),
      metadata: {
        linkCategory: {
          category,
          fetchedAt: CAPTURED_AT,
          sourceUrl: markedUrl(slug),
        },
      } as never,
      metadataTitle: title,
      tags: [READER_MIX_TAG],
      type: "link",
      url: markedUrl(slug),
      ...fields,
    },
    setup,
  };
};

export const READER_MIX: ReaderMixCard[] = [
  readerCard(
    "long-form",
    "The patient garden: a long read",
    "article",
    { images: 3, markdown: longForm, ready: true },
    { byline: "Ada Gardener" }
  ),
  readerCard("news", "City opens three new community gardens", "news", {
    markdown: () => NEWS,
    ready: true,
  }),
  readerCard(
    "research",
    "Mulch depth and soil moisture in small plots",
    "research",
    { markdown: () => RESEARCH, ready: true },
    { byline: "R. Field, S. Loam" }
  ),
  readerCard("product", "Garden hose, 25 m", "product", { none: true }),
  readerCard("text-only", "A page kept as text only", "article", {
    markdown: () => TEXT_ONLY,
    ready: true,
    textOnly: true,
  }),
  readerCard("arabic", "الحديقة الصبورة", "article", {
    lang: "ar",
    markdown: () => ARABIC,
    ready: true,
  }),
  readerCard("japanese", "忍耐の庭", "article", {
    lang: "ja",
    markdown: () => JAPANESE,
    ready: true,
  }),
  readerCard("truncated", "A page too long to keep whole", "article", {
    markdown: truncated,
    ready: true,
    truncated: true,
  }),
  readerCard("pending", "An article still being prepared", "article", {
    stage: "pending",
  }),
  readerCard("failed", "An article that couldn't be prepared", "article", {
    stage: "failed",
  }),
  readerCard(
    "podcast",
    "Episode 12: The patient garden, with show notes",
    "podcast",
    { markdown: () => PODCAST, ready: true },
    {
      aiTranscript:
        "Welcome to episode twelve. Today we talk about patience in the garden.",
    }
  ),
];

const archiveKey = (userId: string, cardId: Id<"cards">) =>
  buildR2ObjectKey({
    userId,
    cardId,
    role: PAGE_ARCHIVE_ROLE,
    objectId: "r0",
    fileName: "archive.html",
  });

/**
 * Inserts the mix's cards with their saved copies and article states, then
 * schedules the objects' upload; ready articles are recorded once their
 * Markdown and images are in storage, as the workflow would.
 */
export const seedReaderMix = async (
  ctx: MutationCtx,
  userId: string
): Promise<{ cards: number; status: "already_seeded" | "seeded" }> => {
  const first = READER_MIX[0]?.card.url as string;
  const seeded = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", first)
    )
    .first();
  if (seeded) {
    return { cards: 0, status: "already_seeded" };
  }
  const ids = await insertCompletedCards(
    ctx,
    userId,
    READER_MIX.map(({ card }) => card),
    { ignoreCardLimit: true }
  );
  const archives: Array<{
    key: string;
    kind: "full" | "text_only";
    url: string;
  }> = [];
  const articles: Array<{ cardId: Id<"cards">; index: number }> = [];
  for (const [index, entry] of READER_MIX.entries()) {
    const cardId = ids[index] as Id<"cards">;
    const card = await ctx.db.get("cards", cardId);
    if (!card) {
      continue;
    }
    const url = entry.card.url as string;
    const kind =
      "ready" in entry.setup && entry.setup.textOnly ? "text_only" : "full";
    const key = archiveKey(userId, cardId);
    if (await registerOwnedObject(ctx, userId, key)) {
      archives.push({ key, kind, url });
    }
    const { setup } = entry;
    let article: Doc<"cards">["processingStatus"] = {};
    if ("none" in setup) {
      article = { article: stageCompleted(CAPTURED_AT) };
    } else if ("stage" in setup) {
      article = {
        article:
          setup.stage === "pending"
            ? stagePending()
            : stageFailed(CAPTURED_AT, "extract_error"),
      };
    } else {
      article = { article: stagePending() };
      articles.push({ cardId, index });
    }
    await ctx.db.patch("cards", cardId, {
      pageArchive: {
        bytes: 40_000,
        capturedAt: CAPTURED_AT,
        kind,
        source: "server",
        sourceUrl: url,
        storageKey: key,
      },
      processingStatus: {
        ...(card.processingStatus ?? {}),
        archive: stageCompleted(CAPTURED_AT),
        ...article,
      },
      ...("none" in setup
        ? { article: { status: "none" as const, extractedAt: CAPTURED_AT } }
        : {}),
    });
  }
  await ctx.scheduler.runAfter(
    0,
    internal.devSeed.articles.writeReaderMixObjects,
    { archives, articles, userId }
  );
  return { cards: ids.length, status: "seeded" };
};

const encoder = new TextEncoder();

/** Writes the mix's copies, Markdown and images, then records the articles. */
export const writeReaderMixObjects = internalAction({
  args: {
    archives: v.array(
      v.object({
        key: v.string(),
        kind: v.union(v.literal("full"), v.literal("text_only")),
        url: v.string(),
      })
    ),
    articles: v.array(v.object({ cardId: v.id("cards"), index: v.number() })),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { archives, articles, userId }) => {
    for (const archive of archives) {
      await putObjectViaFilesWorker({
        body: encoder.encode(stubArchiveHtml(archive.kind, archive.url)),
        contentType: "text/html",
        key: archive.key,
      });
    }
    const prefix = buildR2UserPrefix(userId);
    for (const { cardId, index } of articles) {
      const entry = READER_MIX[index];
      if (!(entry && "ready" in entry.setup)) {
        continue;
      }
      const { setup } = entry;
      const markdown = setup.markdown();
      const textKey = articleTextObjectKey(
        prefix,
        cardId,
        await sha256Hex(markdown)
      );
      const imageKeys: string[] = [];
      for (let image = 0; image < (setup.images ?? 0); image += 1) {
        const svg = svgImage(image * 110 + 20, `Image ${image + 1}`);
        const key = articleImageObjectKey(prefix, cardId, await sha256Hex(svg));
        await ctx.runMutation(internal.devSeed.articles.registerSeedObject, {
          key,
          userId,
        });
        await putObjectViaFilesWorker({
          body: encoder.encode(svg),
          contentType: "image/svg+xml",
          key,
        });
        imageKeys.push(key);
      }
      await ctx.runMutation(internal.devSeed.articles.registerSeedObject, {
        key: textKey,
        userId,
      });
      await putObjectViaFilesWorker({
        body: encoder.encode(markdown),
        contentType: "text/markdown; charset=utf-8",
        key: textKey,
      });
      const plainText = articlePlainText(markdown);
      await ctx.runMutation(internal.devSeed.articles.recordSeedArticle, {
        cardId,
        textKey,
        searchText: searchPrefix(plainText),
        charCount: codePointLength(plainText),
        truncated: setup.truncated === true,
        article: {
          imageKeys,
          wordCount: countWords(plainText),
          ...(entry.card.metadataTitle
            ? { title: entry.card.metadataTitle }
            : {}),
          ...(entry.byline ? { byline: entry.byline } : {}),
          ...(setup.lang ? { lang: setup.lang } : {}),
        },
      });
    }
    return null;
  },
});

export const registerSeedObject = internalMutation({
  args: { key: v.string(), userId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { key, userId }) => registerOwnedObject(ctx, userId, key),
});

export const recordSeedArticle = internalMutation({
  args: {
    cardId: v.id("cards"),
    textKey: v.string(),
    searchText: v.string(),
    charCount: v.number(),
    truncated: v.boolean(),
    article: v.object({
      imageKeys: v.array(v.string()),
      wordCount: v.number(),
      title: v.optional(v.string()),
      byline: v.optional(v.string()),
      lang: v.optional(v.string()),
    }),
  },
  returns: v.boolean(),
  handler: saveArticleTextHandler,
});

export const READER_SEARCH_SIZE = 1000;
export const READER_SEARCH_PAGE_SIZE = 200;
/** In every card's body and no title: it finds all 1,000. */
export const READER_SEARCH_SHARED_PHRASE = "amber kestrel lantern";
const SEARCH_START = Date.UTC(2025, 0, 1);

/** The word only card `index`'s body has: `lantern0` to `lantern999`. */
export const readerSearchToken = (index: number) => `lantern${index}`;

/**
 * 1,000 links with articles whose titles share no word with the phrases in
 * their body. Search rows only: their Markdown isn't written, so the Read tab
 * says it couldn't load them.
 */
export const seedReaderSearchPage = async (
  ctx: MutationCtx,
  userId: string,
  page: number
): Promise<{ cards: number; status: "already_seeded" | "seeded" }> => {
  const indexes = Array.from(
    { length: READER_SEARCH_PAGE_SIZE },
    (_, offset) => page * READER_SEARCH_PAGE_SIZE + offset
  ).filter((index) => index < READER_SEARCH_SIZE);
  if (indexes.length === 0) {
    return { cards: 0, status: "already_seeded" };
  }
  const url = (index: number) =>
    `https://example.com/reader-search/${index}#${SCENARIO_MARKER}-reader-search`;
  const marker = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", url(indexes[0] as number))
    )
    .first();
  if (marker) {
    return { cards: 0, status: "already_seeded" };
  }
  const ids = await insertCompletedCards(
    ctx,
    userId,
    indexes.map((index) => ({
      content: url(index),
      createdAt: SEARCH_START + index * 3_600_000,
      metadataTitle: `Field note ${index + 1}`,
      tags: ["scenario-reader-search"],
      type: "link" as const,
      url: url(index),
    })),
    { ignoreCardLimit: true }
  );
  const prefix = buildR2UserPrefix(userId);
  for (const [offset, cardId] of ids.entries()) {
    const index = indexes[offset] as number;
    const text = `An ${READER_SEARCH_SHARED_PHRASE} hangs by the shed. Its mark reads ${readerSearchToken(index)}. ${paragraph(index, "the shed")}`;
    // A stand-in digest: these articles have no Markdown in storage.
    const textKey = articleTextObjectKey(
      prefix,
      cardId,
      index.toString(16).padStart(64, "0")
    );
    const wordCount = countWords(text);
    await ctx.db.insert("cardTextContents", {
      cardId,
      userId,
      kind: "article",
      text,
      sourceKey: textKey,
      charCount: codePointLength(text),
      truncated: false,
    });
    const card = await ctx.db.get("cards", cardId);
    await ctx.db.patch("cards", cardId, {
      article: {
        status: "ready",
        textKey,
        imageKeys: [],
        wordCount,
        readingMinutes: readingMinutes(wordCount),
        extractedAt: SEARCH_START,
      },
      documentTextKey: textKey,
      hasExtractedText: true,
      extractedTextCharCount: codePointLength(text),
      processingStatus: {
        ...(card?.processingStatus ?? {}),
        article: stageCompleted(SEARCH_START),
      },
    });
  }
  return { cards: ids.length, status: "seeded" };
};
