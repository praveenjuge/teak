"use client";

import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useEffect, useId, useMemo, useState } from "react";
import { Check, Search, Tag } from "vadivam-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useRetainedWhileClosing } from "../../hooks/useRetainedWhileClosing";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import type { StartTagOperationInput } from "../../hooks/useTagOperations";
import { isImeComposing } from "../../lib/keyboardShortcuts";
import {
  explainTagNameInput,
  MAX_TAG_NAME_LENGTH,
  type TagSummaryItem,
  tagErrorCode,
  tagKey,
} from "../../lib/tags";
import { cn } from "../../lib/utils";

export type TagManagerMode = "rename" | "merge" | "delete";

const MERGE_LIST_LIMIT = 200;

interface TagManagerDialogProps {
  initialTarget?: string;
  mode: TagManagerMode | null;
  onModeChange: (mode: TagManagerMode, target?: string) => void;
  onOpenChange: (open: boolean) => void;
  onStart: (input: StartTagOperationInput) => Promise<unknown>;
  open: boolean;
  tag: TagSummaryItem | null;
  tags: readonly TagSummaryItem[];
}

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
  const shown = useRetainedWhileClosing(
    tag && mode ? { initialTarget, mode, tag } : null,
    open
  );
  if (!shown) {
    return null;
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "sm:max-w-sm",
          shown.mode === "merge" && "gap-0 overflow-hidden p-0"
        )}
      >
        <TagManagerForm
          initialTarget={shown.initialTarget}
          key={`${shown.mode}:${shown.tag.name}:${shown.initialTarget ?? ""}`}
          mode={shown.mode}
          onModeChange={onModeChange}
          onOpenChange={onOpenChange}
          onStart={onStart}
          tag={shown.tag}
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
  const t = useTranslations("modals.tagManager");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const tErrors = useTranslations("errors");
  const intlLocale = useIntlLocale();
  const inputId = useId();
  const listId = useId();
  const [name, setName] = useState(tag.name);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(initialTarget ?? null);
  const [activeIndex, setActiveIndex] = useState(0);
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
          message: errors.message(caught, t("startFailed")),
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
  const shownTargets = mergeTargets.slice(0, MERGE_LIST_LIMIT);
  const optionId = (index: number) => `${listId}-option-${index}`;
  const activeTarget = shownTargets[activeIndex];

  useEffect(() => {
    if (mode === "merge") {
      document
        .getElementById(`${listId}-option-${activeIndex}`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [activeIndex, listId, mode]);

  let problem: string | null = null;
  if (mode === "rename") {
    problem = trimmed ? explainTagNameInput(trimmed, tErrors) : null;
    if (!problem && existing) {
      problem = t("nameTaken", { name: existing.name });
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

  const titles: Record<TagManagerMode, string> = {
    rename: t("renameTitle"),
    merge: t("mergeTitle", { name: tag.name }),
    delete: t("deleteTitle", { name: tag.name }),
  };
  const descriptions: Record<TagManagerMode, string> = {
    rename: t("renameDescription", { name: tag.name, count: tag.count }),
    merge: t("mergeDescription", { name: tag.name }),
    delete: t("deleteDescription", { name: tag.name, count: tag.count }),
  };
  const submitLabels: Record<TagManagerMode, string> = {
    rename: tc("rename"),
    merge: target ? t("mergeInto", { name: target }) : t("merge"),
    delete: t("deleteTag"),
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
            <Label htmlFor={inputId}>{t("newName")}</Label>
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
                aria-activedescendant={
                  activeTarget ? optionId(activeIndex) : undefined
                }
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded="true"
                aria-label={t("findTag")}
                autoFocus
                className="h-11 rounded-none border-0 pl-11 shadow-none focus-visible:ring-0"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (isImeComposing(event) || shownTargets.length === 0) {
                    return;
                  }
                  const count = shownTargets.length;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((index) => (index + 1) % count);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((index) => (index - 1 + count) % count);
                  } else if (
                    event.key === "Enter" &&
                    activeTarget &&
                    activeTarget.name !== target
                  ) {
                    // The first Enter picks the highlighted tag; the next
                    // one merges into it, as the button then says.
                    event.preventDefault();
                    setTarget(activeTarget.name);
                    setServerError(null);
                  }
                }}
                placeholder={t("findTag")}
                role="combobox"
                value={query}
              />
            </div>
            <div
              aria-label={t("tagsLabel")}
              className="max-h-64 overflow-y-auto p-1.5"
              id={listId}
              role="listbox"
            >
              {mergeTargets.length === 0 && (
                <p className="px-3 py-6 text-center text-muted-foreground text-sm">
                  {query.trim() ? t("noMatch") : t("noOtherTags")}
                </p>
              )}
              {shownTargets.map((item, index) => {
                const selected = item.name === target;
                return (
                  <button
                    aria-selected={selected}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                      index === activeIndex && "bg-accent/60",
                      selected && "bg-accent text-accent-foreground"
                    )}
                    data-active={index === activeIndex ? "" : undefined}
                    id={optionId(index)}
                    key={item.name}
                    onClick={() => {
                      setTarget(item.name);
                      setActiveIndex(index);
                      setServerError(null);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    tabIndex={-1}
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
                        {item.count.toLocaleString(intlLocale)}
                      </span>
                    )}
                  </button>
                );
              })}
              {mergeTargets.length > MERGE_LIST_LIMIT && (
                <p className="px-3 py-2 text-muted-foreground text-xs">
                  {t("typeToFindMore")}
                </p>
              )}
            </div>
          </>
        )}

        {errorText ? (
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
                {t("mergeIntoInstead", { name: mergeSuggestion })}
              </Button>
            )}
          </div>
        ) : null}

        <DialogFooter className={cn(mode === "merge" && "border-t p-4")}>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {tc("cancel")}
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
