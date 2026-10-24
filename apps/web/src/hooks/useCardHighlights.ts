import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  highlightLength,
  MAX_HIGHLIGHT_QUOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "@teak/convex/shared/highlights/constants";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@/lib/convexQueryHooks";
import {
  type CardHighlight,
  createPendingHighlightIds,
  highlightProblem,
  type NewHighlight,
  optimisticHighlightId,
  undoRemovalInput,
  withNewHighlight,
} from "./cardHighlights";

export type { CardHighlight, NewHighlight } from "./cardHighlights";

export interface CardHighlightsControl {
  /** Highlights the passage; resolves true when it was saved. */
  create: (input: NewHighlight) => Promise<boolean>;
  highlights: CardHighlight[] | undefined;
  /** At 200 a card takes no more. */
  isFull: boolean;
  remove: (highlight: CardHighlight) => Promise<void>;
  updateNote: (highlight: CardHighlight, note: string) => Promise<void>;
}

const HIGHLIGHT_TOAST_ID = "card-highlight";

/**
 * A link card's highlights, and the reader's writes to them: each one
 * changes the list at once and rolls back with a toast when it fails.
 */
export function useCardHighlights(
  cardId: string | null | undefined,
  enabled: boolean
): CardHighlightsControl {
  const t = useTranslations("cardPreviews.highlights");
  const tc = useTranslations("common");
  const args = useMemo(
    () => (cardId ? { cardId: cardId as Id<"cards"> } : null),
    [cardId]
  );
  const highlights = useQuery(
    api.highlight.highlights.listForCard,
    enabled && args ? args : "skip"
  );
  const [pendingIds] = useState(createPendingHighlightIds);

  const createHighlight = useMutation(
    api.highlight.highlights.create
  ).withOptimisticUpdate((store, input) => {
    const query = { cardId: input.cardId };
    const list = store.getQuery(api.highlight.highlights.listForCard, query);
    if (!list) {
      return;
    }
    store.setQuery(
      api.highlight.highlights.listForCard,
      query,
      withNewHighlight(list, input, {
        cardId: input.cardId,
        id: optimisticHighlightId(input),
        now: Date.now(),
      }).list
    );
  });
  const updateHighlightNote = useMutation(
    api.highlight.highlights.updateNote
  ).withOptimisticUpdate((store, input) => {
    for (const { args: query, value } of store.getAllQueries(
      api.highlight.highlights.listForCard
    )) {
      if (value?.some((row: CardHighlight) => row._id === input.highlightId)) {
        store.setQuery(
          api.highlight.highlights.listForCard,
          query,
          value.map((row: CardHighlight) =>
            row._id === input.highlightId
              ? { ...row, note: input.note?.trim() || undefined }
              : row
          )
        );
      }
    }
  });
  const removeHighlight = useMutation(
    api.highlight.highlights.remove
  ).withOptimisticUpdate((store, input) => {
    for (const { args: query, value } of store.getAllQueries(
      api.highlight.highlights.listForCard
    )) {
      if (value?.some((row: CardHighlight) => row._id === input.highlightId)) {
        store.setQuery(
          api.highlight.highlights.listForCard,
          query,
          value.filter((row: CardHighlight) => row._id !== input.highlightId)
        );
      }
    }
  });

  const showProblem = useCallback(
    (error: unknown) => {
      const problem = highlightProblem(error);
      const message = {
        failed: t("saveFailed"),
        limit: t("limitReached", { max: MAX_HIGHLIGHTS_PER_CARD }),
        noArticle: t("saveFailed"),
        rateLimited: t("rateLimited"),
        tooLong: t("tooLong", { max: MAX_HIGHLIGHT_QUOTE_CHARS }),
      }[problem];
      toast.error(message, { id: HIGHLIGHT_TOAST_ID });
    },
    [t]
  );

  const create = useCallback(
    async (input: NewHighlight): Promise<boolean> => {
      if (!args) {
        return false;
      }
      if (highlightLength(input.quote) > MAX_HIGHLIGHT_QUOTE_CHARS) {
        toast.error(t("tooLong", { max: MAX_HIGHLIGHT_QUOTE_CHARS }), {
          id: HIGHLIGHT_TOAST_ID,
        });
        return false;
      }
      try {
        const tempId = optimisticHighlightId(input);
        const saving = createHighlight({
          articleKey: input.articleKey,
          cardId: args.cardId,
          quote: input.quote,
          start: input.start,
          end: input.end,
          ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
          ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
          ...(input.note ? { note: input.note } : {}),
        });
        pendingIds.track(tempId, saving);
        const result = await saving;
        if (result.merged) {
          toast(t("merged"), { id: HIGHLIGHT_TOAST_ID });
        }
        return true;
      } catch (error) {
        showProblem(error);
        return false;
      }
    },
    [args, createHighlight, pendingIds, showProblem, t]
  );

  const updateNote = useCallback(
    async (highlight: CardHighlight, note: string) => {
      const next = note.trim();
      if (next === (highlight.note ?? "")) {
        return;
      }
      const highlightId = await pendingIds.resolve(highlight._id);
      if (!highlightId) {
        return;
      }
      try {
        await updateHighlightNote({
          highlightId: highlightId as Id<"highlights">,
          note: next ? next : null,
        });
      } catch (error) {
        showProblem(error);
      }
    },
    [pendingIds, showProblem, updateHighlightNote]
  );

  const remove = useCallback(
    async (highlight: CardHighlight) => {
      const highlightId = await pendingIds.resolve(highlight._id);
      if (!highlightId) {
        return;
      }
      try {
        await removeHighlight({ highlightId: highlightId as Id<"highlights"> });
      } catch (error) {
        showProblem(error);
        return;
      }
      const input = undoRemovalInput(highlight);
      // Through `create`, so a note typed on the restored highlight while it
      // saves waits for its real id too.
      const undo = input
        ? () => {
            create(input);
          }
        : undefined;
      toast(t("removed"), {
        id: HIGHLIGHT_TOAST_ID,
        ...(undo ? { action: { label: tc("undo"), onClick: undo } } : {}),
      });
    },
    [create, pendingIds, removeHighlight, showProblem, t, tc]
  );

  return useMemo(
    () => ({
      create,
      highlights,
      isFull: (highlights?.length ?? 0) >= MAX_HIGHLIGHTS_PER_CARD,
      remove,
      updateNote,
    }),
    [create, highlights, remove, updateNote]
  );
}
