import type { api } from "@teak/convex";
import {
  type HighlightSpan,
  spansOverlap,
  unionSpans,
} from "@teak/convex/shared/highlights/anchor";
import { cleanHighlightNote } from "@teak/convex/shared/highlights/constants";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";

/** One of a card's highlights, as the reader and the panel read them. */
export type CardHighlight = FunctionReturnType<
  typeof api.highlight.highlights.listForCard
>[number];

export interface NewHighlight extends HighlightSpan {
  /** The article the offsets were measured in (`cards.article.textKey`). */
  articleKey: string;
  note?: string;
}

const isAnchored = (
  highlight: CardHighlight
): highlight is CardHighlight & { end: number; start: number } =>
  highlight.unanchored !== true &&
  highlight.start !== undefined &&
  highlight.end !== undefined;

const inArticleOrder = (list: CardHighlight[]): CardHighlight[] =>
  [...list].sort(
    (a, b) =>
      (isAnchored(a) ? a.start : Number.POSITIVE_INFINITY) -
        (isAnchored(b) ? b.start : Number.POSITIVE_INFINITY) ||
      a.createdAt - b.createdAt
  );

/**
 * The list as it will be once a highlight is made, as the server makes it:
 * the same passage again changes nothing, and one that overlaps others
 * merges with them into the oldest, which keeps the first note.
 */
export const withNewHighlight = (
  list: readonly CardHighlight[],
  input: NewHighlight,
  stamp: { cardId: CardHighlight["cardId"]; id: string; now: number }
): { list: CardHighlight[]; merged: boolean } => {
  if (
    list.some(
      (row) =>
        isAnchored(row) && row.start === input.start && row.end === input.end
    )
  ) {
    return { list: [...list], merged: false };
  }
  const group: CardHighlight[] = [];
  let union: HighlightSpan = input;
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of list) {
      if (isAnchored(row) && !group.includes(row) && spansOverlap(union, row)) {
        group.push(row);
        union = unionSpans(union, {
          start: row.start,
          end: row.end,
          quote: row.quote,
          prefix: row.prefix,
          suffix: row.suffix,
        });
        grew = true;
      }
    }
  }
  const fields = {
    quote: union.quote,
    start: union.start,
    end: union.end,
    prefix: union.prefix,
    suffix: union.suffix,
    updatedAt: stamp.now,
  };
  if (group.length === 0) {
    const created = {
      _id: stamp.id as CardHighlight["_id"],
      _creationTime: stamp.now,
      userId: "",
      cardId: stamp.cardId,
      ...fields,
      ...(cleanHighlightNote(input.note) ? { note: input.note?.trim() } : {}),
      source: "reader" as const,
      createdAt: stamp.now,
    };
    return { list: inArticleOrder([...list, created]), merged: false };
  }
  const members = [...group].sort((a, b) => a.createdAt - b.createdAt);
  const keeper = members[0] as CardHighlight;
  const note =
    members.find((row) => cleanHighlightNote(row.note))?.note ??
    cleanHighlightNote(input.note);
  const kept = { ...keeper, ...fields, note };
  return {
    list: inArticleOrder([...list.filter((row) => !group.includes(row)), kept]),
    merged: true,
  };
};

export type HighlightProblem =
  | "failed"
  | "limit"
  | "noArticle"
  | "rateLimited"
  | "tooLong";

/** What went wrong with a highlight write, for the toast that says so. */
export const highlightProblem = (error: unknown): HighlightProblem => {
  const data =
    error instanceof ConvexError
      ? (error.data as { code?: unknown; message?: unknown } | null)
      : null;
  switch (data?.code) {
    case "RATE_LIMITED":
      return "rateLimited";
    case "HIGHLIGHT_LIMIT":
      return "limit";
    case "NO_ARTICLE":
      return "noArticle";
    case "INVALID_INPUT":
      return typeof data.message === "string" &&
        data.message.startsWith("Highlights can be up to")
        ? "tooLong"
        : "failed";
    default:
      return "failed";
  }
};

/**
 * What Undo makes again after a highlight is removed: the same passage in the
 * article it was made in. A highlight still waiting for its article has
 * nothing to point at, so it can't come back that way.
 */
export const undoRemovalInput = (
  highlight: CardHighlight
): NewHighlight | null => {
  const { articleKey, end, start } = highlight;
  if (
    highlight.unanchored ||
    start === undefined ||
    end === undefined ||
    !articleKey
  ) {
    return null;
  }
  return {
    articleKey,
    quote: highlight.quote,
    start,
    end,
    ...(highlight.prefix === undefined ? {} : { prefix: highlight.prefix }),
    ...(highlight.suffix === undefined ? {} : { suffix: highlight.suffix }),
    ...(highlight.note ? { note: highlight.note } : {}),
  };
};

/** The highlight whose note is open, and the text it covered when opened. */
export interface OpenedHighlight {
  end: number;
  id: string;
  start: number;
}

/**
 * The highlight an open note belongs to. A new highlight shows under a
 * temporary id until its create returns, and the server's row then takes its
 * place under another id: the note stays open on the row covering the same
 * text instead of closing under the reader's hands.
 */
export const findOpenHighlight = (
  highlights: CardHighlight[],
  opened: OpenedHighlight | null
): CardHighlight | undefined => {
  if (!opened) {
    return undefined;
  }
  return (
    highlights.find((highlight) => highlight._id === opened.id) ??
    highlights.find(
      (highlight) => isAnchored(highlight) && spansOverlap(opened, highlight)
    )
  );
};

const OPTIMISTIC_ID_PREFIX = "optimistic-";

/**
 * The id a new highlight shows until its create returns the real one. It
 * comes from the passage, not a counter: Convex runs an optimistic update
 * again whenever query results arrive, and the row must keep its id each
 * time.
 */
export const optimisticHighlightId = (span: {
  end: number;
  start: number;
}): string => `${OPTIMISTIC_ID_PREFIX}${span.start}-${span.end}`;

/**
 * The server id each optimistic highlight turns into. A note typed, or a
 * removal asked for, while a new highlight is still being saved waits for
 * its real id instead of sending the temporary one, which the server
 * refuses.
 */
export const createPendingHighlightIds = () => {
  const pending = new Map<string, Promise<string | null>>();
  return {
    /** Records what the optimistic `tempId` becomes once `saved` returns. */
    track(tempId: string, saved: Promise<{ highlight: { _id: string } }>) {
      pending.set(
        tempId,
        saved.then(
          (result) => result.highlight._id,
          () => null
        )
      );
    },
    /** The id to send for `id`: itself, or null when its create failed. */
    resolve(id: string): Promise<string | null> {
      if (!id.startsWith(OPTIMISTIC_ID_PREFIX)) {
        return Promise.resolve(id);
      }
      return pending.get(id) ?? Promise.resolve(null);
    },
  };
};
