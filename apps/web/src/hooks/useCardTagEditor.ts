import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_DURATION_MS } from "../constants/toast";
import { addTagToCard, findTag, tagsWithout } from "../lib/cardTags";
import { useUpdateCardField } from "./useCardMutations";
import { useServerErrors } from "./useServerErrors";

type TagCard = Pick<Doc<"cards">, "_id" | "aiTags" | "isHidden" | "tags">;

/**
 * Adds and removes one card's tags, for the card dialog and the grid's tag
 * dialog alike. `card` is null while the card is unknown: nothing is written
 * then, since a whole new tag list would replace the tags it has.
 */
export function useCardTagEditor(card: TagCard | null) {
  const t = useTranslations("hooks.cardActions");
  const tc = useTranslations("common");
  const serverErrors = useServerErrors();
  const updateCardField = useUpdateCardField();
  const cardId = card?._id ?? null;
  const [input, setInputValue] = useState("");
  // Why the last tag typed wasn't added, shown until the text changes.
  const [error, setError] = useState<string | null>(null);
  const [editsCardId, setEditsCardId] = useState(cardId);
  if (editsCardId !== cardId) {
    setEditsCardId(cardId);
    setInputValue("");
    setError(null);
  }
  const setInput = useCallback((value: string) => {
    setInputValue(value);
    setError(null);
  }, []);

  // The tags the card has once the writes on their way land. A second edit
  // before the card's query catches up builds on the first, so quick edits
  // all stick.
  const writes = useRef<{
    cardId: string | null;
    pending?: string[];
    seen?: readonly string[];
  }>({ cardId });
  if (writes.current.cardId !== cardId || writes.current.seen !== card?.tags) {
    writes.current = { cardId, seen: card?.tags };
  }
  const currentTags = useCallback(
    () => writes.current.pending ?? writes.current.seen ?? [],
    []
  );

  const write = useCallback(
    async (
      targetId: Id<"cards">,
      edit: { field: "tags"; value: string[] } | { tagToRemove: string },
      tracked: boolean
    ) => {
      if (tracked && "value" in edit) {
        writes.current.pending = edit.value;
      }
      try {
        await updateCardField(
          "value" in edit
            ? { cardId: targetId, field: "tags", value: edit.value }
            : {
                cardId: targetId,
                field: "removeAiTag",
                tagToRemove: edit.tagToRemove,
              }
        );
        return true;
      } catch (caught) {
        captureClientException(caught, { operation: "card.tags" });
        toast.error(
          serverErrors.message(
            caught,
            t("value" in edit ? "failed.tags" : "failed.removeTag")
          )
        );
        if (
          tracked &&
          "value" in edit &&
          writes.current.pending === edit.value
        ) {
          writes.current.pending = undefined;
        }
        return false;
      }
    },
    [serverErrors, t, updateCardField]
  );

  const writeTags = useCallback(
    (tags: string[]) =>
      cardId ? write(cardId, { field: "tags", value: tags }, true) : false,
    [cardId, write]
  );

  const addTag = useCallback(() => {
    if (!card) {
      return;
    }
    const result = addTagToCard({ ...card, tags: currentTags() }, input);
    if (result.kind === "empty") {
      return;
    }
    if (result.kind === "exists") {
      setInput("");
      toast(t("alreadyTagged", { tag: result.existing }));
      return;
    }
    if (result.kind === "invalid") {
      setError(serverErrors.byEnglishMessage(result.message));
      return;
    }
    setInput("");
    const addedTo = card._id;
    const { tag, tags } = result;
    void Promise.resolve(writeTags(tags)).then((didUpdate) => {
      if (!(didUpdate && result.hides)) {
        return;
      }
      toast(t("hiddenByTag", { tag }), {
        duration: UNDO_TOAST_DURATION_MS,
        action: {
          label: tc("undo"),
          onClick: () => {
            if (writes.current.cardId === addedTo) {
              void writeTags(tagsWithout(currentTags(), [tag]));
            } else {
              // Another card is open now; this one's tags aren't tracked.
              void write(
                addedTo,
                { field: "tags", value: tagsWithout(tags, [tag]) },
                false
              );
            }
          },
        },
      });
    });
  }, [
    card,
    currentTags,
    input,
    serverErrors,
    setInput,
    t,
    tc,
    write,
    writeTags,
  ]);

  const acceptAiTag = useCallback(
    (tag: string) => {
      const tags = currentTags();
      if (!findTag(tags, tag)) {
        void writeTags([...tags, tag]);
      }
    },
    [currentTags, writeTags]
  );

  const removeTag = useCallback(
    (tag: string) => {
      // A full card has room again, so the reason the typed tag wasn't added
      // no longer holds; Enter says so again if it still applies.
      setError(null);
      void writeTags(tagsWithout(currentTags(), [tag]));
    },
    [currentTags, writeTags]
  );

  const removeAiTag = useCallback(
    (tag: string) => {
      if (cardId) {
        void write(cardId, { tagToRemove: tag }, false);
      }
    },
    [cardId, write]
  );

  return {
    acceptAiTag,
    addTag,
    error,
    input,
    removeAiTag,
    removeTag,
    setInput,
  };
}

export type CardTagEditor = ReturnType<typeof useCardTagEditor>;
