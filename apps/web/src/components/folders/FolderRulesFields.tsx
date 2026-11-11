"use client";

import { api } from "@teak/convex";
import { parseSearchQuery } from "@teak/convex/shared";
import {
  MAX_FOLDER_AUTO_TAGS,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "@teak/convex/shared/folders";
import {
  explainInvalidTagName,
  HIDDEN_TAG_KEYS,
  tagKey,
} from "@teak/convex/shared/tags";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useEffect, useId, useState } from "react";
import { Plus, X } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { useQuery } from "@/lib/convexQueryHooks";
import type { FolderSummary } from "@/lib/folders";
import { isImeComposing } from "@/lib/keyboardShortcuts";
import { convexErrorData } from "@/lib/serverErrors";
import { cn } from "@/lib/utils";

const PREVIEW_DELAY_MS = 300;

const hiddenTagIn = (tags: readonly string[]) =>
  tags.find((tag) =>
    (HIDDEN_TAG_KEYS as readonly string[]).includes(tagKey(tag))
  );

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const withTag = (tags: string[], tag: string) =>
  tags.some((other) => tagKey(other) === tagKey(tag)) ? tags : [...tags, tag];

export interface FolderRulesPatch {
  autoFileEnabled?: boolean;
  autoFileQuery: string | null;
  autoTags: string[];
}

/**
 * A manual folder's rules as the Edit folder dialog edits them: the tags
 * every card put in the folder gets, and a search whose matches are filed in
 * it. A tag still being typed counts, so Save doesn't drop it.
 */
export function useFolderRulesForm(
  folder: FolderSummary | null | undefined,
  open: boolean
) {
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const canonicalQuery = parseSearchQuery(query).canonical;
  const [previewQuery, setPreviewQuery] = useDebouncedValue(
    canonicalQuery,
    PREVIEW_DELAY_MS
  );
  const active = open && folder?.kind === "manual";

  useEffect(() => {
    if (active) {
      setTags(folder.rules?.autoTags ?? []);
      setTagInput("");
      setQuery(folder.rules?.autoFile?.query ?? "");
      setPreviewQuery(folder.rules?.autoFile?.query ?? "");
      setEnabled(folder.rules?.autoFile?.enabled ?? true);
      setExpanded(
        (folder.rules?.autoTags.length ?? 0) > 0 ||
          Boolean(folder.rules?.autoFile)
      );
    }
  }, [active, folder, setPreviewQuery]);

  const preview = useQuery(
    api.folders.previewFolderRule,
    active && previewQuery ? { query: previewQuery } : "skip"
  );
  const lastRun = useQuery(
    api.folders.getFolderRuleRun,
    active && folder.ruleRunId
      ? { folderId: folder._id, runId: folder.ruleRunId }
      : "skip"
  );

  const pendingTag = tagInput.trim();
  const tagProblem = pendingTag ? explainInvalidTagName(pendingTag) : null;
  const atTagLimit = tags.length >= MAX_FOLDER_AUTO_TAGS;
  const nextTags =
    pendingTag && !tagProblem && !atTagLimit ? withTag(tags, pendingTag) : tags;
  const queryProblem =
    preview && "error" in preview && previewQuery === canonicalQuery
      ? preview.error
      : null;
  const saved = folder?.rules;
  const savedEnabled = saved?.autoFile?.enabled ?? true;
  const unchanged =
    !active ||
    (sameList(nextTags, saved?.autoTags ?? []) &&
      canonicalQuery === (saved?.autoFile?.query ?? "") &&
      (!canonicalQuery || enabled === savedEnabled));

  return {
    active,
    addTag: () => {
      if (!pendingTag || tagProblem || atTagLimit) {
        return;
      }
      setTags(withTag(tags, pendingTag));
      setTagInput("");
    },
    atTagLimit,
    canonicalQuery,
    enabled,
    expanded,
    expand: () => setExpanded(true),
    folder,
    lastRun,
    patch: (): FolderRulesPatch | null =>
      unchanged
        ? null
        : {
            autoTags: nextTags,
            autoFileQuery: canonicalQuery || null,
            ...(canonicalQuery ? { autoFileEnabled: enabled } : {}),
          },
    nextTags,
    preview: previewQuery === canonicalQuery ? preview : undefined,
    problem: tagProblem ?? queryProblem,
    query,
    queryProblem,
    removeTag: (tag: string) => setTags(tags.filter((other) => other !== tag)),
    savedEnabled,
    setEnabled,
    setQuery,
    setTagInput,
    tagInput,
    tagProblem,
    tags,
    unchanged,
  };
}

export type FolderRulesForm = ReturnType<typeof useFolderRulesForm>;

/** The Rules section of the Edit folder dialog. */
export function FolderRulesFields({
  form,
  onChange,
  onUndone,
}: {
  form: FolderRulesForm;
  /** Any edit, so the dialog can clear a stale save error. */
  onChange: () => void;
  /** Undo of the last run started; the dialog closes and follows it. */
  onUndone: (runId: NonNullable<FolderRulesForm["lastRun"]>["_id"]) => void;
}) {
  const t = useTranslations("folders.rules");
  const errors = useServerErrors();
  const tagInputId = useId();
  const queryId = useId();
  const enabledId = useId();
  const undoRun = useMutation(api.folders.undoFolderRuleRun);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [focusTags, setFocusTags] = useState(false);
  const { folder, lastRun, preview } = form;

  const [undo, isUndoing] = useSingleFlight(async () => {
    if (!(folder && lastRun)) {
      return;
    }
    setUndoError(null);
    try {
      await undoRun({ folderId: folder._id, runId: lastRun._id });
      onUndone(lastRun._id);
    } catch (caught) {
      setUndoError(convexErrorData(caught).message ?? t("undoFailed"));
    }
  });

  let queryHelp: string | null = null;
  if (form.queryProblem) {
    queryHelp = errors.byEnglishMessage(form.queryProblem);
  } else if (form.canonicalQuery) {
    if (!preview || "error" in preview) {
      queryHelp = t("checking");
    } else {
      queryHelp = preview.capped
        ? t("matchesCapped", { count: preview.matches })
        : t("matches", { count: preview.matches });
    }
  }
  let tagHelp: string | null = null;
  if (form.tagProblem) {
    tagHelp = errors.byEnglishMessage(form.tagProblem);
  } else if (form.atTagLimit) {
    tagHelp = t("tagsLimit", { max: MAX_FOLDER_AUTO_TAGS });
  }
  // Counts a tag still being typed, since Save adds it too.
  const hiddenTag = hiddenTagIn(form.nextTags);
  const lastRunText = lastRun ? lastRunSummary(t, lastRun) : null;

  if (!form.expanded) {
    return (
      <div className="border-t pt-4">
        <Button
          className="h-auto gap-1.5 px-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setFocusTags(true);
            form.expand();
          }}
          size="sm"
          type="button"
          variant="link"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t("addRule")}
        </Button>
      </div>
    );
  }

  return (
    <fieldset className="space-y-4 border-t pt-5">
      <legend className="sr-only">{t("legend")}</legend>
      <div className="space-y-2">
        <Label htmlFor={tagInputId}>{t("tagsLabel")}</Label>
        <div
          className={cn(
            "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
            form.tagProblem && "border-destructive"
          )}
        >
          {form.tags.map((tag) => (
            <span
              className="inline-flex h-6 max-w-full items-center gap-0.5 rounded bg-secondary pr-0.5 pl-1.5 text-secondary-foreground text-sm"
              key={tagKey(tag)}
            >
              <span className="truncate" dir="auto">
                {tag}
              </span>
              <button
                aria-label={t("removeTag", { tag })}
                className="flex size-5 items-center justify-center rounded-sm outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  form.removeTag(tag);
                  onChange();
                }}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
          <input
            aria-describedby={tagHelp ? `${tagInputId}-help` : undefined}
            aria-invalid={form.tagProblem ? true : undefined}
            autoComplete="off"
            autoFocus={focusTags}
            className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            disabled={form.atTagLimit}
            id={tagInputId}
            onChange={(event) => {
              form.setTagInput(event.target.value);
              onChange();
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event)) {
                return;
              }
              if (event.key === "Enter" || event.key === ",") {
                if (form.tagInput.trim()) {
                  event.preventDefault();
                  form.addTag();
                }
              } else if (
                event.key === "Backspace" &&
                !form.tagInput &&
                form.tags.length > 0
              ) {
                form.removeTag(form.tags.at(-1) ?? "");
                onChange();
              }
            }}
            placeholder={form.tags.length > 0 ? "" : t("tagsPlaceholder")}
            value={form.tagInput}
          />
        </div>
        {tagHelp ? (
          <p
            className={cn(
              "text-sm",
              form.tagProblem ? "text-destructive" : "text-muted-foreground"
            )}
            id={`${tagInputId}-help`}
            role={form.tagProblem ? "alert" : undefined}
          >
            {tagHelp}
          </p>
        ) : null}
        {hiddenTag ? (
          <p className="text-amber-700 text-sm dark:text-amber-400">
            {t("hiddenWarning", { tag: hiddenTag })}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={queryId}>{t("fileLabel")}</Label>
        <Input
          aria-describedby={queryHelp ? `${queryId}-help` : undefined}
          aria-invalid={form.queryProblem ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="font-mono text-[13px]"
          id={queryId}
          maxLength={MAX_SMART_FOLDER_QUERY_LENGTH * 2}
          onChange={(event) => {
            form.setQuery(event.target.value);
            onChange();
          }}
          // biome-ignore lint/plugin: search syntax, which stays English.
          placeholder="tag:fonts type:link"
          spellCheck={false}
          value={form.query}
        />
        <p
          aria-live="polite"
          className={cn(
            "text-sm empty:hidden",
            form.queryProblem ? "text-destructive" : "text-muted-foreground"
          )}
          id={`${queryId}-help`}
          role={form.queryProblem ? "alert" : undefined}
        >
          {queryHelp}
        </p>
        {form.canonicalQuery && !form.savedEnabled ? (
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.enabled}
              id={enabledId}
              onCheckedChange={(checked) => {
                form.setEnabled(checked === true);
                onChange();
              }}
            />
            <Label htmlFor={enabledId}>{t("enabledLabel")}</Label>
          </div>
        ) : null}
      </div>
      {lastRunText ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted-foreground text-sm">
          <span>{lastRunText}</span>
          {lastRun?.canUndo ? (
            <Button
              className="h-auto px-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              disabled={isUndoing}
              onClick={() => {
                undo().catch(() => undefined);
              }}
              size="sm"
              type="button"
              variant="link"
            >
              {t("undoLastRun")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {undoError ? (
        <p className="text-destructive text-sm" role="alert">
          {errors.byEnglishMessage(undoError)}
        </p>
      ) : null}
    </fieldset>
  );
}

type RulesTranslator = TeakTranslator<"folders.rules">;

/** What the last run did, in one sentence. */
const lastRunSummary = (
  t: RulesTranslator,
  run: NonNullable<FolderRulesForm["lastRun"]>
): string | null => {
  if (run.status === "running") {
    return t("lastRunRunning");
  }
  if (run.status === "undone") {
    return t("lastRunUndone");
  }
  return run.canUndo && run.changedCount > 0
    ? t("lastRun", { count: run.changedCount })
    : null;
};
