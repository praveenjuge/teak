"use client";

import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Input } from "@teak/ui/components/ui/input";
import { Label } from "@teak/ui/components/ui/label";
import { Check, Search, Tag } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import type { StartTagOperationInput } from "../../hooks/useTagOperations";
import {
  explainTagNameInput,
  MAX_TAG_NAME_LENGTH,
  type TagSummaryItem,
  tagErrorCode,
  tagErrorMessage,
  tagKey,
} from "../../lib/tags";
import { cn } from "../../lib/utils";

export type TagManagerMode = "rename" | "merge" | "delete";

const MERGE_LIST_LIMIT = 200;

interface TagManagerDialogProps {
  /** The tag merge starts with selected (from "Merge instead"). */
  initialTarget?: string;
  /** Rename, merge or delete. Kept while the dialog closes. */
  mode: TagManagerMode | null;
  onModeChange: (mode: TagManagerMode, target?: string) => void;
  onOpenChange: (open: boolean) => void;
  /** Starts the change; rejects with the server's error when refused. */
  onStart: (input: StartTagOperationInput) => Promise<unknown>;
  open: boolean;
  tag: TagSummaryItem | null;
  tags: readonly TagSummaryItem[];
}

const cardsLabel = (count: number) =>
  `${count.toLocaleString()} card${count === 1 ? "" : "s"}`;

/**
 * Renames, merges or deletes a tag across the whole library. The change
 * runs in the background; this dialog only starts it.
 */
export function TagManagerDialog({
  mode,
  open,
  tag,
  tags,
  initialTarget,
  onModeChange,
  onOpenChange,
  onStart,
}: TagManagerDialogProps) {
  if (!(tag && mode)) {
    return null;
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "sm:max-w-sm",
          mode === "merge" && "gap-0 overflow-hidden p-0"
        )}
      >
        <TagManagerForm
          initialTarget={initialTarget}
          key={`${mode}:${tag.name}:${initialTarget ?? ""}`}
          mode={mode}
          onModeChange={onModeChange}
          onOpenChange={onOpenChange}
          onStart={onStart}
          tag={tag}
          tags={tags}
        />
      </DialogContent>
    </Dialog>
  );
}

function TagManagerForm({
  mode,
  tag,
  tags,
  initialTarget,
  onModeChange,
  onOpenChange,
  onStart,
}: Omit<TagManagerDialogProps, "mode" | "open" | "tag"> & {
  mode: TagManagerMode;
  tag: TagSummaryItem;
}) {
  const inputId = useId();
  const listId = useId();
  const [name, setName] = useState(tag.name);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(initialTarget ?? null);
  const [serverError, setServerError] = useState<{
    code?: string;
    message: string;
  } | null>(null);

  const [startChange, isSaving] = useSingleFlight(
    async (input: StartTagOperationInput) => {
      setServerError(null);
      try {
        await onStart(input);
        onOpenChange(false);
      } catch (caught) {
        setServerError({
          code: tagErrorCode(caught),
          message: tagErrorMessage(caught, "Couldn't start the tag change"),
        });
      }
    }
  );

  const fromKey = tagKey(tag.name);
  const trimmed = name.trim();
  const existing =
    mode === "rename" && trimmed && tagKey(trimmed) !== fromKey
      ? tags.find((item) => item.name === tagKey(trimmed))
      : undefined;

  const mergeTargets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tags.filter(
      (item) => item.name !== fromKey && (!needle || item.name.includes(needle))
    );
  }, [fromKey, query, tags]);

  let problem: string | null = null;
  if (mode === "rename") {
    problem = trimmed ? explainTagNameInput(trimmed) : null;
    if (!problem && existing) {
      problem = `A tag named “${existing.name}” already exists.`;
    }
  }
  const canSubmit =
    !(isSaving || problem) &&
    (mode === "delete" ||
      (mode === "rename" && Boolean(trimmed) && trimmed !== tag.name) ||
      (mode === "merge" && target !== null));

  const mergeSuggestion =
    existing?.name ??
    (serverError?.code === "TAG_EXISTS" ? tagKey(trimmed) : undefined);
  const errorText = problem ?? serverError?.message ?? null;

  const scope = `${cardsLabel(tag.count)}, plus any in Archive or Trash`;
  const titles: Record<TagManagerMode, string> = {
    rename: "Rename tag",
    merge: `Merge “${tag.name}” into…`,
    delete: `Delete “${tag.name}”?`,
  };
  const descriptions: Record<TagManagerMode, string> = {
    rename: `Renames “${tag.name}” on ${scope}.`,
    merge: `Cards tagged “${tag.name}” get the tag you pick instead. A card with both keeps one.`,
    delete: `Removes “${tag.name}” from ${scope}. The cards are kept. This can't be undone.`,
  };
  const submitLabels: Record<TagManagerMode, string> = {
    rename: "Rename",
    merge: target ? `Merge into “${target}”` : "Merge",
    delete: "Delete tag",
  };

  return (
    <>
      <DialogHeader className={cn(mode === "merge" && "px-5 pt-5 pb-3")}>
        <DialogTitle className="break-words pr-6" dir="auto">
          {titles[mode]}
        </DialogTitle>
        <DialogDescription className="break-words" dir="auto">
          {descriptions[mode]}
        </DialogDescription>
      </DialogHeader>
      <form
        className={cn("min-w-0", mode !== "merge" && "space-y-5")}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            startChange(
              mode === "delete"
                ? { kind: "delete", from: tag.name }
                : {
                    kind: mode,
                    from: tag.name,
                    to: mode === "merge" ? (target ?? "") : trimmed,
                  }
            ).catch(() => undefined);
          }
        }}
      >
        {mode === "rename" && (
          <div className="space-y-2">
            <Label htmlFor={inputId}>New name</Label>
            <Input
              aria-describedby={errorText ? `${inputId}-error` : undefined}
              aria-invalid={errorText ? true : undefined}
              autoComplete="off"
              autoFocus
              dir="auto"
              id={inputId}
              maxLength={MAX_TAG_NAME_LENGTH * 2}
              onChange={(event) => {
                setName(event.target.value);
                setServerError(null);
              }}
              onFocus={(event) => event.currentTarget.select()}
              value={name}
            />
          </div>
        )}

        {mode === "merge" && (
          <>
            <div className="relative border-y">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-controls={listId}
                aria-label="Find a tag"
                autoFocus
                className="h-11 rounded-none border-0 pl-11 shadow-none focus-visible:ring-0"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a tag"
                value={query}
              />
            </div>
            <div
              aria-label="Tags"
              className="max-h-64 overflow-y-auto p-1.5"
              id={listId}
              role="listbox"
            >
              {mergeTargets.length === 0 && (
                <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                  {query.trim() ? "No tag by that name." : "No other tags yet."}
                </p>
              )}
              {mergeTargets.slice(0, MERGE_LIST_LIMIT).map((item) => {
                const selected = item.name === target;
                return (
                  <button
                    aria-selected={selected}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                      selected && "bg-accent text-accent-foreground"
                    )}
                    key={item.name}
                    onClick={() => {
                      setTarget(item.name);
                      setServerError(null);
                    }}
                    role="option"
                    type="button"
                  >
                    <Tag
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span
                      className="min-w-0 flex-1 truncate"
                      dir="auto"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                    {selected ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {item.count.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
              {mergeTargets.length > MERGE_LIST_LIMIT && (
                <p className="px-3 py-2 text-muted-foreground text-xs">
                  Type to find more tags.
                </p>
              )}
            </div>
          </>
        )}

        {errorText && (
          <div
            className={cn(
              "space-y-1.5 text-sm",
              mode === "merge" && "border-t px-5 py-3"
            )}
            id={`${inputId}-error`}
            role="alert"
          >
            <p className="text-destructive">{errorText}</p>
            {mergeSuggestion && mode === "rename" && (
              <Button
                className="h-auto p-0"
                onClick={() => onModeChange("merge", mergeSuggestion)}
                type="button"
                variant="link"
              >
                Merge into “{mergeSuggestion}” instead
              </Button>
            )}
          </div>
        )}

        <DialogFooter className={cn(mode === "merge" && "border-t p-4")}>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className="max-w-full"
            disabled={!canSubmit}
            type="submit"
            variant={mode === "delete" ? "destructive" : "default"}
          >
            <span className="truncate">{submitLabels[mode]}</span>
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
