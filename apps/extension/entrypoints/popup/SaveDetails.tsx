import { MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
import { Button } from "@teak/ui/components/ui/button";
import { Check, X } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MAX_PATCH_TAGS } from "../../lib/cardPatch";
import { readRecentTags, suggestTags } from "../../lib/recentTags";
import {
  type CardPatchResponse,
  MESSAGE_TYPES,
  type PatchCardPayload,
  SAVE_DETAILS_PORT,
  type SaveDetailsDraftMessage,
  type SaveDetailsResponse,
} from "../../types/messages";

interface SaveDetailsProps {
  cardId: string;
  /** The page was already saved: its tags and note load first. */
  existing: boolean;
  /** A field took focus; the popup stays open from now on. */
  onTouched: () => void;
  userId: string;
}

interface Saved {
  notes: string;
  tags: string[];
}

const NOTE_SAVED_MS = 1000;

const sameTags = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((tag, index) => tag === b[index]);

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

const failureMessage = (result: CardPatchResponse, tags: boolean) => {
  if (result.status === "unauthenticated") {
    return "Sign in again to save your changes.";
  }
  if (result.status === "error" && result.code === "RATE_LIMITED") {
    return result.message;
  }
  return tags ? "Couldn't save tags." : "Couldn't save the note.";
};

/**
 * Tags and a note for the card the popup just saved (or found already
 * saved). Changes go to the card when a field loses focus, on Enter in the
 * tag input, and when the popup closes; the background sends them, so they
 * land even after the popup is gone.
 */
export function SaveDetails({
  cardId,
  existing,
  onTouched,
  userId,
}: SaveDetailsProps) {
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    existing ? "loading" : "ready"
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
  // What was last sent (so a blur and Enter don't send it twice), and what
  // Teak confirmed. The background's draft is measured from the confirmed
  // copy: a save sent as the popup closes can be lost on the way.
  const saved = useRef<Saved>({ notes: "", tags: [] });
  const confirmed = useRef<Saved>({ notes: "", tags: [] });
  const current = useRef<Saved>({ notes: "", tags: [] });
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    setLoadState(existing ? "loading" : "ready");
    void readRecentTags(userId)
      .then(setRecentTags)
      .catch(() => undefined);
    let result: SaveDetailsResponse | undefined;
    try {
      result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.LOAD_SAVE_DETAILS,
        payload: { cardId, existing },
      });
    } catch {}
    if (result?.status !== "ok") {
      // A new card's fields work without suggestions; an existing card's
      // tags must load first, or saving would replace them.
      setLoadState(existing ? "error" : "ready");
      return;
    }
    setLibraryTags(result.libraryTags);
    if (result.card) {
      saved.current = { ...result.card };
      confirmed.current = { ...result.card };
      current.current = { ...result.card };
      setTags(result.card.tags);
      setNotes(result.card.notes);
    }
    setLoadState("ready");
  }, [cardId, existing, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => clearTimeout(noteTimer.current), []);

  /** What changed since `base`, or null when nothing did. */
  const changeSince = useCallback(
    (base: Saved): PatchCardPayload | null => {
      if (loadState !== "ready") {
        return null;
      }
      const next = current.current;
      const change: PatchCardPayload = { cardId };
      if (!sameTags(next.tags, base.tags)) {
        change.tags = next.tags;
      }
      if (next.notes !== base.notes) {
        change.notes = next.notes;
      }
      return change.tags === undefined && change.notes === undefined
        ? null
        : change;
    },
    [cardId, loadState]
  );

  // The background keeps the latest unsaved change and sends it when the
  // popup closes, since a message sent while it closes can be lost.
  const port = useRef<chrome.runtime.Port>(undefined);
  useEffect(() => {
    const connection = chrome.runtime.connect({ name: SAVE_DETAILS_PORT });
    port.current = connection;
    return () => {
      port.current = undefined;
      connection.disconnect();
    };
  }, []);

  /** Tells the background what would be lost if the popup closed now. */
  const postDraft = useCallback(() => {
    const message: SaveDetailsDraftMessage = {
      draft: changeSince(confirmed.current),
    };
    try {
      port.current?.postMessage(message);
    } catch {}
  }, [changeSince]);

  /** Sends what changed since the last save; nothing when nothing did. */
  const save = useCallback(() => {
    const change = changeSince(saved.current);
    if (!change) {
      return;
    }
    const next = current.current;
    const before = saved.current;
    // Counted as saved at once, so a blur and the popup closing don't send
    // the same change twice; a failure marks it unsaved again.
    saved.current = { ...next };
    postDraft();
    void sendPatch(change).then((result) => {
      if (result.status === "updated") {
        confirmed.current = {
          notes: change.notes ?? confirmed.current.notes,
          tags: change.tags ?? confirmed.current.tags,
        };
        postDraft();
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
      if (change.tags !== undefined && saved.current.tags === change.tags) {
        saved.current = { ...saved.current, tags: before.tags };
      }
      if (change.notes !== undefined && saved.current.notes === change.notes) {
        saved.current = { ...saved.current, notes: before.notes };
      }
      postDraft();
      setSaveError(failureMessage(result, change.tags !== undefined));
    });
  }, [changeSince, postDraft]);

  const updateTags = (next: string[]) => {
    current.current = { ...current.current, tags: next };
    setTags(next);
    postDraft();
  };

  /** Adds the typed tag; false when it can't be added. */
  const addTag = (raw: string) => {
    const name = raw.trim();
    if (!name) {
      return true;
    }
    if (name.length > MAX_TAG_NAME_LENGTH) {
      setTagError(`Tags can be at most ${MAX_TAG_NAME_LENGTH} characters.`);
      return false;
    }
    const key = name.toLowerCase();
    if (!tags.some((tag) => tag.toLowerCase() === key)) {
      if (tags.length >= MAX_PATCH_TAGS) {
        setTagError(`A card can have at most ${MAX_PATCH_TAGS} tags here.`);
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
      <div aria-busy="true" className="w-full" role="status">
        <span className="sr-only">Loading tags</span>
        <div className="h-8 w-full animate-pulse rounded-lg bg-muted" />
        <div className="mt-2 h-14 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-3 text-left text-xs"
        role="alert"
      >
        <span className="text-muted-foreground">
          Couldn&apos;t load this card&apos;s tags.
        </span>
        <Button
          className="h-7 px-2.5 text-xs"
          onClick={() => void load()}
          size="sm"
          variant="ghost"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2 text-left starting:opacity-0 transition-opacity duration-150">
      <div>
        <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          {tags.map((tag) => (
            <span
              className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-md bg-secondary pr-0.5 pl-2 text-secondary-foreground text-xs"
              key={tag}
            >
              <span className="max-w-40 truncate" dir="auto" title={tag}>
                {tag}
              </span>
              <button
                aria-label={`Remove tag ${tag}`}
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
            aria-label="Tags"
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
              onTouched();
            }}
            onKeyDown={handleTagKeyDown}
            placeholder={tags.length ? "" : "Add tags"}
            role="combobox"
            value={tagInput}
          />
        </div>
      </div>
      {/*
       * In the flow, not over the note: a click on the note field always
       * reaches it, and the chips fold away once the tag input loses focus.
       */}
      {suggestions.length > 0 ? (
        <div
          aria-label="Suggested tags"
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
      <div className="relative">
        <textarea
          aria-label="Note"
          className="field-sizing-content block max-h-[8.5rem] min-h-14 w-full resize-none overflow-y-auto rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          dir="auto"
          onBlur={save}
          onChange={(event) => {
            current.current = { ...current.current, notes: event.target.value };
            postDraft();
            setNotes(event.target.value);
          }}
          onFocus={onTouched}
          placeholder="Add a note"
          value={notes}
        />
        {noteSaved ? (
          <span
            aria-live="polite"
            className="pointer-events-none absolute right-2 bottom-1.5 inline-flex items-center gap-1 text-emerald-600 text-xs dark:text-emerald-400"
          >
            <Check aria-hidden="true" className="size-3" />
            Saved
          </span>
        ) : null}
      </div>
      {saveError ? (
        <div
          className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 py-1 pr-1 pl-3 text-destructive text-xs"
          role="alert"
        >
          <span>{saveError}</span>
          <Button
            className="h-7 px-2.5 text-xs"
            onClick={save}
            size="sm"
            variant="ghost"
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}
