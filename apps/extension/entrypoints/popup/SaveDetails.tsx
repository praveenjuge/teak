import { MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, X } from "vadivam-react";
import { Button } from "../../components/ui/button";
import { MAX_PATCH_TAGS } from "../../lib/cardPatch";
import { readRecentTags, suggestTags } from "../../lib/recentTags";
import {
  type CardPatchResponse,
  MESSAGE_TYPES,
  type PatchCardPayload,
  type SaveDetailsResponse,
} from "../../types/messages";
import { useDraftSync } from "./useDraftSync";

interface SaveDetailsProps {
  alreadySaved: boolean;
  cardId: string;
  onKeepOpen: () => void;
  userId: string;
}

const NOTE_SAVED_MS = 1000;

const sendPatch = async (
  payload: PatchCardPayload
): Promise<CardPatchResponse> => {
  try {
    const result: CardPatchResponse | undefined =
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PATCH_CARD,
        payload,
      });
    return (
      result ?? { status: "error", message: "Couldn't save your changes." }
    );
  } catch {
    return { status: "error", message: "Couldn't save your changes." };
  }
};

const failureMessage = (
  result: CardPatchResponse,
  tags: boolean,
  t: TeakTranslator<"extension.popup.details">
) => {
  if (result.status === "unauthenticated") {
    return t("signInAgain");
  }
  if (result.status === "error" && result.code === "RATE_LIMITED") {
    return result.message;
  }
  return tags ? t("tagsFailed") : t("noteFailed");
};

/** The tag and note rows, greyed out, while the page saves, so the card doesn't jump when they arrive. */
export function DetailsPlaceholder() {
  const t = useTranslations("extension.popup.details");
  return (
    <div aria-hidden="true" className="text-muted-foreground/60 text-sm">
      <p className="flex min-h-11 items-center px-3">{t("addTags")}</p>
      <p className="min-h-16 border-t px-3 py-2.5">{t("addNote")}</p>
    </div>
  );
}

export function SaveDetails({
  alreadySaved,
  cardId,
  onKeepOpen,
  userId,
}: SaveDetailsProps) {
  const t = useTranslations("extension.popup.details");
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    alreadySaved ? "loading" : "ready"
  );
  const [libraryTags, setLibraryTags] = useState<string[]>([]);
  const [recentTags, setRecentTags] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagFocused, setTagFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [tagError, setTagError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draft = useDraftSync({
    cardId,
    ready: loadState === "ready",
    sendPatch,
  });
  const loadDraft = draft.load;

  const load = useCallback(async () => {
    setLoadState(alreadySaved ? "loading" : "ready");
    void readRecentTags(userId)
      .then(setRecentTags)
      .catch(() => undefined);
    const result: SaveDetailsResponse | undefined = await chrome.runtime
      .sendMessage({
        type: MESSAGE_TYPES.LOAD_SAVE_DETAILS,
        payload: { alreadySaved, cardId },
      })
      .catch(() => undefined);
    if (result?.status !== "ok") {
      setLoadState(alreadySaved ? "error" : "ready");
      return;
    }
    setLibraryTags(result.libraryTags);
    if (result.card) {
      loadDraft(result.card);
      setTags(result.card.tags);
      setNotes(result.card.notes);
    }
    setLoadState("ready");
  }, [alreadySaved, cardId, loadDraft, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  const save = () => {
    const sending = draft.send();
    if (!sending) {
      return;
    }
    const { change, result } = sending;
    void result.then((response) => {
      if (response.status === "updated") {
        setSaveError(null);
        if (change.notes !== undefined) {
          setNoteSaved(true);
          clearTimeout(noteTimer.current);
          noteTimer.current = setTimeout(
            () => setNoteSaved(false),
            NOTE_SAVED_MS
          );
        }
        return;
      }
      setSaveError(failureMessage(response, change.tags !== undefined, t));
    });
  };

  const updateTags = (next: string[]) => {
    draft.edit({ tags: next });
    setTags(next);
  };

  const addTag = (raw: string) => {
    const name = raw.trim();
    if (!name) {
      return true;
    }
    if (name.length > MAX_TAG_NAME_LENGTH) {
      setTagError(t("tagTooLong", { max: MAX_TAG_NAME_LENGTH }));
      return false;
    }
    const key = name.toLowerCase();
    if (!tags.some((tag) => tag.toLowerCase() === key)) {
      if (tags.length >= MAX_PATCH_TAGS) {
        setTagError(t("tooManyTags", { max: MAX_PATCH_TAGS }));
        return false;
      }
      updateTags([...tags, name]);
    }
    setTagError(null);
    setTagInput("");
    setHighlighted(-1);
    return true;
  };

  const removeTag = (name: string) => {
    updateTags(tags.filter((tag) => tag !== name));
    save();
  };

  const suggestions = tagFocused
    ? suggestTags({
        library: libraryTags,
        query: tagInput,
        recent: recentTags,
        selected: tags,
      })
    : [];

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length > 0) {
        event.preventDefault();
        const last = suggestions.length - 1;
        setHighlighted((index) => {
          if (event.key === "ArrowDown") {
            return index >= last ? 0 : index + 1;
          }
          return index <= 0 ? last : index - 1;
        });
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = suggestions[highlighted];
      if (addTag(picked ?? tagInput)) {
        save();
      }
      return;
    }
    if (event.key === "," && tagInput.trim()) {
      event.preventDefault();
      addTag(tagInput);
      return;
    }
    if (event.key === "Backspace" && !tagInput && tags.length > 0) {
      event.preventDefault();
      updateTags(tags.slice(0, -1));
    }
  };

  if (loadState === "loading") {
    return (
      <div aria-busy="true" className="w-full space-y-2 p-3" role="status">
        <span className="sr-only">{t("loadingTags")}</span>
        <div className="h-6 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        className="flex w-full items-center justify-between gap-2 py-1.5 pr-1.5 pl-3 text-left text-xs"
        role="alert"
      >
        <span className="text-muted-foreground">{t("loadFailed")}</span>
        <Button
          className="h-7 px-2.5 text-xs"
          onClick={() => void load()}
          size="sm"
          variant="ghost"
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full text-left starting:opacity-0 transition-opacity duration-150">
      <div className="space-y-2 px-2 py-2 transition-colors focus-within:bg-muted/40">
        <div className="flex min-h-7 flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <span
              className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-secondary pr-0.5 pl-2 text-secondary-foreground text-xs"
              key={tag}
            >
              <span className="max-w-40 truncate" dir="auto" title={tag}>
                {tag}
              </span>
              <button
                aria-label={t("removeTag", { tag })}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                onClick={() => removeTag(tag)}
                type="button"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            aria-activedescendant={
              highlighted >= 0 ? `teak-tag-option-${highlighted}` : undefined
            }
            aria-autocomplete="list"
            aria-controls="teak-tag-options"
            aria-expanded={suggestions.length > 0}
            aria-invalid={tagError ? true : undefined}
            aria-label={t("tags")}
            className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
            enterKeyHint="done"
            onBlur={() => {
              setTagFocused(false);
              setHighlighted(-1);
              addTag(tagInput);
              save();
            }}
            onChange={(event) => {
              setTagInput(event.target.value);
              setTagError(null);
              setHighlighted(-1);
            }}
            onFocus={() => {
              setTagFocused(true);
              onKeepOpen();
            }}
            onKeyDown={handleTagKeyDown}
            placeholder={tags.length ? "" : t("addTags")}
            role="combobox"
            value={tagInput}
          />
        </div>
        {suggestions.length > 0 ? (
          <div
            aria-label={t("suggestedTags")}
            className="flex flex-wrap gap-1"
            id="teak-tag-options"
            role="listbox"
          >
            {suggestions.map((tag, index) => (
              <div
                aria-selected={index === highlighted}
                className="inline-flex h-6 max-w-40 cursor-default items-center rounded-md border border-dashed px-2 text-muted-foreground text-xs hover:border-solid hover:bg-accent hover:text-foreground aria-selected:border-solid aria-selected:bg-accent aria-selected:text-foreground"
                dir="auto"
                id={`teak-tag-option-${index}`}
                key={tag}
                onMouseDown={(event) => {
                  // Keeps focus in the input, so it doesn't blur first.
                  event.preventDefault();
                  if (addTag(tag)) {
                    save();
                  }
                }}
                role="option"
                tabIndex={-1}
                title={tag}
              >
                <span className="truncate">{tag}</span>
              </div>
            ))}
          </div>
        ) : null}
        {tagError ? (
          <p className="px-1 text-destructive text-xs" role="alert">
            {tagError}
          </p>
        ) : null}
      </div>
      <div className="relative border-t transition-colors focus-within:bg-muted/40">
        <textarea
          aria-label={t("note")}
          className="field-sizing-content block max-h-[8.5rem] min-h-16 w-full resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
          dir="auto"
          onBlur={save}
          onChange={(event) => {
            draft.edit({ notes: event.target.value });
            setNotes(event.target.value);
          }}
          onFocus={onKeepOpen}
          placeholder={t("addNote")}
          value={notes}
        />
        {noteSaved ? (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-2 bottom-1.5 inline-flex items-center gap-1 text-emerald-600 text-xs dark:text-emerald-400"
          >
            <Check aria-hidden="true" className="size-3" />
            {t("saved")}
          </span>
        ) : null}
      </div>
      {saveError ? (
        <div
          className="flex items-center justify-between gap-2 border-t bg-destructive/10 py-1 pr-1.5 pl-3 text-destructive text-xs"
          role="alert"
        >
          <span>{saveError}</span>
          <Button
            className="h-7 px-2.5 text-xs"
            onClick={save}
            size="sm"
            variant="ghost"
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
