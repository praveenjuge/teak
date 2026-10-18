"use client";

import { api } from "@teak/convex";
import { parseSearchQuery } from "@teak/convex/shared";
import {
  explainInvalidFolderName,
  explainInvalidSmartFolderQuery,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "@teak/convex/shared/folders";
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
import { Textarea } from "@teak/ui/components/ui/textarea";
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useFolders } from "../../hooks/useFolders";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import {
  FOLDER_COLOR_LABELS,
  FOLDER_COLORS,
  FOLDER_DOT_CLASSES,
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderColor,
  type FolderSummary,
  folderErrorMessage,
  hasFolderNamed,
  suggestSmartFolderName,
} from "../../lib/folders";
import { cn } from "../../lib/utils";

interface FolderNameDialogProps {
  focusQuery?: boolean;
  folder?: FolderSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (folder: FolderSummary) => void;
  open: boolean;
  query?: string;
  queryNote?: string;
}

export function FolderNameDialog({
  folder,
  focusQuery = false,
  open,
  onOpenChange,
  onSaved,
  query: initialQuery,
  queryNote,
}: FolderNameDialogProps) {
  const inputId = useId();
  const queryId = useId();
  const folders = useFolders();
  const createFolder = useMutation(api.folders.createFolder);
  const updateFolder = useMutation(api.folders.updateFolder);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<FolderColor | undefined>(undefined);
  const [serverError, setServerError] = useState<string | null>(null);
  const isRename = Boolean(folder);
  const isSmart = folder ? folder.kind === "smart" : initialQuery !== undefined;

  useEffect(() => {
    if (open) {
      setName(
        folder?.name ??
          (initialQuery === undefined
            ? ""
            : suggestSmartFolderName(initialQuery))
      );
      setQuery(folder?.query ?? initialQuery ?? "");
      setColor(folder?.color);
      setServerError(null);
    }
  }, [folder, initialQuery, open]);

  const trimmed = name.trim();
  const canonicalQuery = isSmart ? parseSearchQuery(query).canonical : "";
  let problem: string | null = null;
  if (!isRename && folders && folders.length >= MAX_FOLDERS_PER_USER) {
    problem = FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS;
  } else if (folders && hasFolderNamed(folders, trimmed, folder?._id)) {
    problem = FOLDER_ERROR_MESSAGES.DUPLICATE_NAME;
  } else if (trimmed) {
    problem = explainInvalidFolderName(trimmed);
  }
  const queryIncomplete = isSmart && !canonicalQuery;
  const queryProblem =
    isSmart && canonicalQuery
      ? explainInvalidSmartFolderQuery(canonicalQuery)
      : null;
  const serverErrorIsAboutName =
    serverError !== null &&
    (NAME_ERRORS as readonly string[]).includes(serverError);
  const error =
    problem ?? (!isSmart || serverErrorIsAboutName ? serverError : null);
  const queryError =
    queryProblem ?? (isSmart && !serverErrorIsAboutName ? serverError : null);
  const unchanged =
    isRename &&
    trimmed === folder?.name &&
    color === folder?.color &&
    (!isSmart || canonicalQuery === folder?.query);
  const canSubmit =
    Boolean(trimmed) &&
    !problem &&
    !queryProblem &&
    !queryIncomplete &&
    !unchanged;

  const [submit, isSaving] = useSingleFlight(async () => {
    if (!canSubmit) {
      return;
    }
    setServerError(null);
    try {
      const saved = folder
        ? await updateFolder({
            folderId: folder._id,
            name: trimmed,
            color: color ?? null,
            ...(isSmart ? { query: canonicalQuery } : {}),
          })
        : await createFolder({
            name: trimmed,
            ...(color ? { color } : {}),
            ...(isSmart
              ? { kind: "smart" as const, query: canonicalQuery }
              : {}),
          });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (caught) {
      setServerError(
        folderErrorMessage(
          caught,
          isRename ? "Couldn't save the folder" : "Couldn't create the folder"
        )
      );
    }
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{dialogTitle(isRename, isSmart)}</DialogTitle>
          <DialogDescription className={isSmart ? undefined : "sr-only"}>
            {isSmart
              ? "Shows every card that matches the search, including cards you save later."
              : null}
            {!isSmart && isRename && "Change the folder's name or color."}
            {!(isSmart || isRename) && "Name the folder and pick a color."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit().catch(() => undefined);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              aria-describedby={error ? `${inputId}-error` : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              autoFocus={!focusQuery}
              id={inputId}
              maxLength={FOLDER_NAME_INPUT_MAX_LENGTH}
              onChange={(event) => {
                setName(event.target.value);
                setServerError(null);
              }}
              placeholder="Reading list"
              value={name}
            />
            {error && (
              <p
                className="text-destructive text-sm"
                id={`${inputId}-error`}
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
          {isSmart && (
            <div className="space-y-2">
              <Label htmlFor={queryId}>Search</Label>
              <Textarea
                aria-describedby={
                  queryError || queryNote ? `${queryId}-help` : undefined
                }
                aria-invalid={queryError ? true : undefined}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                autoFocus={focusQuery}
                className="max-h-32 min-h-0 resize-none font-mono text-[13px]"
                id={queryId}
                maxLength={MAX_SMART_FOLDER_QUERY_LENGTH * 2}
                onChange={(event) => {
                  setQuery(event.target.value.replace(/\s*\n\s*/g, " "));
                  setServerError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="tag:design type:link"
                rows={2}
                spellCheck={false}
                value={query}
              />
              {(queryError || queryNote) && (
                <p
                  className={cn(
                    "text-sm",
                    queryError ? "text-destructive" : "text-muted-foreground"
                  )}
                  id={`${queryId}-help`}
                  role={queryError ? "alert" : undefined}
                >
                  {queryError ?? queryNote}
                </p>
              )}
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium text-sm">Color</legend>
            <div className="flex flex-wrap gap-1.5">
              <ColorSwatch
                checked={color === undefined}
                label="No color"
                onSelect={() => setColor(undefined)}
              />
              {FOLDER_COLORS.map((option) => (
                <ColorSwatch
                  checked={color === option}
                  color={option}
                  key={option}
                  label={FOLDER_COLOR_LABELS[option]}
                  onSelect={() => setColor(option)}
                />
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!canSubmit || isSaving} type="submit">
              {submitLabel(isRename, isSmart)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NAME_ERRORS = [
  FOLDER_ERROR_MESSAGES.DUPLICATE_NAME,
  FOLDER_ERROR_MESSAGES.EMPTY_NAME,
  FOLDER_ERROR_MESSAGES.NAME_TOO_LONG,
  FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS,
] as const;

const dialogTitle = (isRename: boolean, isSmart: boolean) => {
  if (isRename) {
    return isSmart ? "Edit smart folder" : "Edit folder";
  }
  return isSmart ? "Save as smart folder" : "New folder";
};

const submitLabel = (isRename: boolean, isSmart: boolean) => {
  if (isRename) {
    return "Save";
  }
  return isSmart ? "Save smart folder" : "Create folder";
};

function ColorSwatch({
  checked,
  color,
  label,
  onSelect,
}: {
  checked: boolean;
  color?: FolderColor;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={cn(
        "flex size-6 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
        color
          ? FOLDER_DOT_CLASSES[color]
          : "border-[1.5px] border-muted-foreground/50 border-dashed",
        checked && "ring-2 ring-foreground/70"
      )}
      onClick={onSelect}
      title={label}
      type="button"
    >
      {checked && (
        <Check
          aria-hidden="true"
          className={cn("size-3", color ? "text-white" : "text-foreground")}
        />
      )}
    </button>
  );
}
