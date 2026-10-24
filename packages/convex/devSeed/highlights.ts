import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { patchCardWithSearchSync } from "../card/searchSync";
import {
  createHighlightForUser,
  insertImportedHighlights,
  loadCardHighlights,
} from "../highlight/highlights";
import { anchorContext } from "../shared/highlights/anchor";
import { MAX_HIGHLIGHTS_PER_CARD } from "../shared/highlights/constants";
import { markdownToReaderText } from "../shared/highlights/readerText";
import { READER_MIX } from "./articles";

/**
 * Highlights on the `reader-mix` articles: one, twelve (one note of 2,000
 * characters) and the cap of 200; a quote repeated in its article; Arabic
 * and Japanese; a merge; imported ones waiting for anchoring (one never
 * matches); and a highlighted podcast to refresh, whose copy must stay.
 */

const SEEDED_AT = Date.UTC(2026, 9, 21, 9);

interface Span {
  end: number;
  note?: string;
  start: number;
}

const entryFor = (slug: string) => {
  const entry = READER_MIX.find((item) =>
    String(item.card.url).includes(`/reader/${slug}#`)
  );
  if (!(entry && "ready" in entry.setup)) {
    throw new Error(`reader-mix has no article ${slug}`);
  }
  return { entry, setup: entry.setup };
};

/** The article's text as the reader shows it, from the pack's Markdown. */
const readerTextOf = (slug: string): string => {
  const { entry, setup } = entryFor(slug);
  return markdownToReaderText(setup.markdown(), {
    imageCount: setup.images ?? 0,
    title: entry.card.metadataTitle,
  });
};

const cardFor = async (
  ctx: MutationCtx,
  userId: string,
  slug: string
): Promise<Doc<"cards">> => {
  const { entry } = entryFor(slug);
  const card = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", entry.card.url as string)
    )
    .first();
  if (card?.article?.status !== "ready") {
    throw new Error(
      "Seed reader-mix first, and wait until its articles are ready."
    );
  }
  return card;
};

/** Every `size` words starting at each `every`-th word, up to `count`. */
const wordSpans = (
  text: string,
  { count, every, size }: { count: number; every: number; size: number }
): Span[] => {
  const words = [...text.matchAll(/\S+/gu)];
  const spans: Span[] = [];
  for (let index = 0; spans.length < count; index += every) {
    const first = words[index];
    const last = words[index + size - 1];
    if (!(first && last)) {
      break;
    }
    spans.push({
      start: first.index,
      end: (last.index as number) + last[0].length,
    });
  }
  return spans;
};

/** The n-th (from 0) place `quote` is in `text`. */
const nth = (text: string, quote: string, n: number): Span => {
  let start = -1;
  for (let seen = 0; seen <= n; seen += 1) {
    start = text.indexOf(quote, start + 1);
  }
  if (start < 0) {
    throw new Error(`not in the article: ${quote}`);
  }
  return { start, end: start + quote.length };
};

/** Writes anchored highlights straight in, as the reader would make them. */
const insertAnchored = async (
  ctx: MutationCtx,
  card: Doc<"cards">,
  text: string,
  spans: Span[]
) => {
  const existing = await loadCardHighlights(ctx, card._id);
  for (const [index, span] of spans.entries()) {
    await ctx.db.insert("highlights", {
      userId: card.userId,
      cardId: card._id,
      quote: text.slice(span.start, span.end),
      ...anchorContext(text, span.start, span.end),
      start: span.start,
      end: span.end,
      ...(card.article?.status === "ready"
        ? { articleKey: card.article.textKey }
        : {}),
      ...(span.note ? { note: span.note } : {}),
      source: "reader",
      createdAt: SEEDED_AT + index,
      updatedAt: SEEDED_AT + index,
    });
  }
  const count = existing.length + spans.length;
  await patchCardWithSearchSync(ctx, card._id, {
    hasHighlights: true,
    highlightCount: count,
    updatedAt: Date.now(),
  });
};

const LONG_NOTE =
  `${"A note that runs to the very limit. ".repeat(56)}End.`.slice(0, 2000);

export const seedHighlightsMix = async (
  ctx: MutationCtx,
  userId: string
): Promise<{ cards: number; status: "already_seeded" | "seeded" }> => {
  const longForm = await cardFor(ctx, userId, "long-form");
  if (longForm.hasHighlights) {
    return { cards: 0, status: "already_seeded" };
  }

  // The cap: 200 three-word highlights through the long read.
  const longText = readerTextOf("long-form");
  await insertAnchored(
    ctx,
    longForm,
    longText,
    wordSpans(longText, {
      count: MAX_HIGHLIGHTS_PER_CARD,
      every: 7,
      size: 3,
    })
  );

  // Twelve, some with notes, one with a 2,000-character note.
  const news = await cardFor(ctx, userId, "news");
  const newsText = readerTextOf("news");
  await insertAnchored(
    ctx,
    news,
    newsText,
    wordSpans(newsText, { count: 12, every: 40, size: 6 }).map(
      (span, index) => {
        if (index === 0) {
          return { ...span, note: LONG_NOTE };
        }
        return index % 3 === 1
          ? { ...span, note: `Note ${index}: worth reading again.` }
          : span;
      }
    )
  );

  // One.
  const research = await cardFor(ctx, userId, "research");
  const researchText = readerTextOf("research");
  await insertAnchored(ctx, research, researchText, [
    { ...nth(researchText, "kept 31% more moisture in July", 0) },
  ]);

  // A quote repeated in every paragraph, highlighted the third time, and
  // three imported highlights waiting for anchoring; one never matches.
  const textOnly = await cardFor(ctx, userId, "text-only");
  const textOnlyText = readerTextOf("text-only");
  await insertAnchored(ctx, textOnly, textOnlyText, [
    {
      ...nth(
        textOnlyText,
        "a garden rewards the patience of whoever tends it",
        2
      ),
      note: "The third time it says so.",
    },
  ]);
  await insertImportedHighlights(ctx, textOnly, [
    { quote: "Paragraph 5 on a page kept as text", note: "Imported note" },
    { quote: "SOIL, LIGHT  AND WATER each ask for attention" },
    { quote: "A sentence that is in no article at all" },
  ]);
  await ctx.scheduler.runAfter(
    0,
    internal.highlight.anchorPending.anchorPendingHighlights,
    { cardId: textOnly._id }
  );

  // Right to left, and Japanese, where a second request overlaps the first
  // and merges with it.
  const arabic = await cardFor(ctx, userId, "arabic");
  const arabicText = readerTextOf("arabic");
  await insertAnchored(ctx, arabic, arabicText, [
    nth(arabicText, "الحديقة تكافئ صبر من يعتني بها", 1),
  ]);
  const japanese = await cardFor(ctx, userId, "japanese");
  const japaneseText = readerTextOf("japanese");
  await insertAnchored(ctx, japanese, japaneseText, [
    { ...nth(japaneseText, "庭は手をかける人の忍耐", 0), note: "最初のメモ" },
  ]);
  const overlap = nth(japaneseText, "忍耐に季節ごとに応えてくれます", 0);
  await createHighlightForUser(
    ctx,
    userId,
    {
      articleKey:
        japanese.article?.status === "ready" ? japanese.article.textKey : "",
      cardId: japanese._id as Id<"cards">,
      quote: japaneseText.slice(overlap.start, overlap.end),
      ...anchorContext(japaneseText, overlap.start, overlap.end),
      start: overlap.start,
      end: overlap.end,
    },
    "reader"
  );

  // A highlighted link to refresh: its copy and article must stay.
  const podcast = await cardFor(ctx, userId, "podcast");
  const podcastText = readerTextOf("podcast");
  await insertAnchored(ctx, podcast, podcastText, [
    {
      ...nth(podcastText, "Paragraph 2 on this episode's show notes", 0),
      note: "Refresh details on this card keeps its saved copy.",
    },
  ]);

  return { cards: 7, status: "seeded" };
};
