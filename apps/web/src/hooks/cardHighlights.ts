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
