"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
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
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useEffect, useId, useState } from "react";
import { X } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { useQuery } from "@/lib/convexQueryHooks";
import { type FolderSummary, folderErrorMessage } from "@/lib/folders";
import { isImeComposing } from "@/lib/keyboardShortcuts";

const PREVIEW_DELAY_MS = 300;

const hiddenTagIn = (tags: readonly string[]) =>
  tags.find((tag) =>
    (HIDDEN_TAG_KEYS as readonly string[]).includes(tagKey(tag))
  );

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

interface FolderRulesDialogProps {
  folder: FolderSummary | null | undefined;
  onOpenChange: (open: boolean) => void;
  /** A save that starts a rule run hands it here to follow. */
  onRunStarted?: (run: {
    folderId: Id<"folders">;
    name: string;
    runId: Id<"folderRuleRuns">;
  }) => void;
  open: boolean;
}

export function FolderRulesDialog({
  folder,
  open,
  onOpenChange,
  onRunStarted,
}: FolderRulesDialogProps) {
  const t = useTranslations("folders.rulesDialog");
  const tRun = useTranslations("folders.ruleRun");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const tagInputId = useId();
  const queryId = useId();
  const enabledId = useId();
  const updateFolder = useMutation(api.folders.updateFolder);
  const undoRun = useMutation(api.folders.undoFolderRuleRun);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [previewQuery, setPreviewQuery] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open && folder) {
      setTags(folder.rules?.autoTags ?? []);
      setTagInput("");
      setQuery(folder.rules?.autoFile?.query ?? "");
      setPreviewQuery(folder.rules?.autoFile?.query ?? "");
      setEnabled(folder.rules?.autoFile?.enabled ?? true);
      setServerError(null);
    }
  }, [folder, open]);

  const canonicalQuery = parseSearchQuery(query).canonical;
  useEffect(() => {
    const timer = setTimeout(
      () => setPreviewQuery(canonicalQuery),
      PREVIEW_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [canonicalQuery]);
  const preview = useQuery(
    api.folders.previewFolderRule,
    open && previewQuery ? { query: previewQuery } : "skip"
  );
  const lastRun = useQuery(
    api.folders.getFolderRuleRun,
    open && folder?.ruleRunId
      ? { folderId: folder._id, runId: folder.ruleRunId }
      : "skip"
  );

  const tagProblem = (() => {
    const trimmed = tagInput.trim();
    if (!trimmed) {
      return null;
    }
    return explainInvalidTagName(trimmed);
  })();
  const atTagLimit = tags.length >= MAX_FOLDER_AUTO_TAGS;
  const addTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed || tagProblem || atTagLimit) {
      return;
    }
    if (!tags.some((tag) => tagKey(tag) === tagKey(trimmed))) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
    setServerError(null);
  };

  const queryProblem =
    preview && "error" in preview && previewQuery === canonicalQuery
      ? preview.error
      : null;
  const savedTags = folder?.rules?.autoTags ?? [];
  const savedQuery = folder?.rules?.autoFile?.query ?? "";
  const savedEnabled = folder?.rules?.autoFile?.enabled ?? true;
  const unchanged =
    sameList(tags, savedTags) &&
    canonicalQuery === savedQuery &&
    (!canonicalQuery || enabled === savedEnabled);
  const canSubmit = Boolean(folder) && !unchanged && !queryProblem;
  const hiddenTag = hiddenTagIn(tags);

  const [submit, isSaving] = useSingleFlight(async () => {
    if (!(folder && canSubmit)) {
      return;
    }
    setServerError(null);
    try {
      const saved = await updateFolder({
        folderId: folder._id,
        autoTags: tags,
        autoFileQuery: canonicalQuery || null,
        ...(canonicalQuery ? { autoFileEnabled: enabled } : {}),
      });
      onOpenChange(false);
      if (saved.ruleRunId && saved.ruleRunId !== folder.ruleRunId) {
        onRunStarted?.({
          folderId: folder._id,
          name: folder.name,
          runId: saved.ruleRunId,
        });
      }
    } catch (caught) {
      setServerError(folderErrorMessage(caught, t("saveFailed")));
    }
  });

  const [undo, isUndoing] = useSingleFlight(async () => {
    if (!(folder && lastRun)) {
      return;
    }
    try {
      await undoRun({ folderId: folder._id, runId: lastRun._id });
      onOpenChange(false);
      onRunStarted?.({
        folderId: folder._id,
        name: folder.name,
        runId: lastRun._id,
      });
    } catch (caught) {
      setServerError(folderErrorMessage(caught, tRun("undoFailed")));
    }
  });

  let previewText: string | null = null;
  if (canonicalQuery && !queryProblem) {
    if (!preview || previewQuery !== canonicalQuery || "error" in preview) {
      previewText = t("checking");
    } else {
      previewText = preview.capped
        ? t("matchesCapped", { count: preview.matches })
        : t("matches", { count: preview.matches });
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { name: folder?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit().catch(() => undefined);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-sm">
              {t("tagsLegend")}
            </legend>
            <p className="text-muted-foreground text-sm">{t("tagsHelp")}</p>
            {tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li
                    className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-secondary-foreground text-sm"
                    key={tagKey(tag)}
                  >
                    <span className="truncate" dir="auto">
                      {tag}
                    </span>
                    <button
                      aria-label={t("removeTag", { tag })}
                      className="flex size-5 items-center justify-center rounded-sm outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setTags(tags.filter((other) => other !== tag));
                        setServerError(null);
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Label className="sr-only" htmlFor={tagInputId}>
                {t("tagInputLabel")}
              </Label>
              <Input
                aria-describedby={`${tagInputId}-help`}
                aria-invalid={tagProblem ? true : undefined}
                autoComplete="off"
                autoFocus
                disabled={atTagLimit}
                id={tagInputId}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isImeComposing(event)) {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("tagInputLabel")}
                value={tagInput}
              />
              <Button
                disabled={!tagInput.trim() || Boolean(tagProblem) || atTagLimit}
                onClick={addTag}
                type="button"
                variant="outline"
              >
                {t("addTag")}
              </Button>
            </div>
            <p
              className={
                tagProblem
                  ? "text-destructive text-sm"
                  : "text-muted-foreground text-xs"
              }
              id={`${tagInputId}-help`}
              role={tagProblem ? "alert" : undefined}
            >
              {tagProblem
                ? errors.byEnglishMessage(tagProblem)
                : t("tagsLimit", { max: MAX_FOLDER_AUTO_TAGS })}
            </p>
            {hiddenTag ? (
              <p className="text-amber-700 text-sm dark:text-amber-400">
                {t("hiddenWarning", { tag: hiddenTag })}
              </p>
            ) : null}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-sm">
              {t("fileLegend")}
            </legend>
            <p className="text-muted-foreground text-sm">{t("fileHelp")}</p>
            <Label htmlFor={queryId}>{t("searchLabel")}</Label>
            <Textarea
              aria-describedby={`${queryId}-help`}
              aria-invalid={queryProblem ? true : undefined}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              className="max-h-32 min-h-0 resize-none font-mono text-[13px]"
              id={queryId}
              maxLength={MAX_SMART_FOLDER_QUERY_LENGTH * 2}
              onChange={(event) => {
                setQuery(event.target.value.replace(/\s*\n\s*/g, " "));
                setServerError(null);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !isImeComposing(event)
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              // biome-ignore lint/plugin: search syntax, which stays English.
              placeholder="tag:fonts type:link"
              rows={2}
              spellCheck={false}
              value={query}
            />
            <p
              aria-live="polite"
              className={
                queryProblem
                  ? "text-destructive text-sm"
                  : "text-muted-foreground text-sm"
              }
              id={`${queryId}-help`}
              role={queryProblem ? "alert" : undefined}
            >
              {queryProblem === null
                ? previewText
                : errors.byEnglishMessage(queryProblem)}
            </p>
            {canonicalQuery ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={enabled}
                  id={enabledId}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                />
                <Label htmlFor={enabledId}>{t("enabledLabel")}</Label>
              </div>
            ) : null}
          </fieldset>
          {lastRun ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-muted-foreground text-sm">
              <span>
                {lastRun.status === "running" && t("lastRunRunning")}
                {lastRun.status === "undone" && t("lastRunUndone")}
                {(lastRun.status === "done" ||
                  lastRun.status === "superseded" ||
                  lastRun.status === "undoing") &&
                  t("lastRun", {
                    filed: lastRun.filedCount,
                    tagged: lastRun.taggedCount,
                  })}
              </span>
              {lastRun.canUndo ? (
                <Button
                  disabled={isUndoing}
                  onClick={() => {
                    undo().catch(() => undefined);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t("undoLastRun")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.byEnglishMessage(serverError)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {tc("cancel")}
            </Button>
            <Button disabled={!canSubmit || isSaving} type="submit">
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
