"use client";

import { api } from "@teak/convex";
import {
  explainInvalidFolderName,
  MAX_FOLDERS_PER_USER,
} from "@teak/convex/shared/folders";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useEffect, useId, useMemo, useState } from "react";
import { Plus, Search } from "vadivam-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useFolders } from "../../hooks/useFolders";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderSummary,
  filterFolders,
  hasFolderNamed,
  manualFolders,
} from "../../lib/folders";
import { isImeComposing } from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import { FolderDot } from "./FolderDot";

interface FolderPickerDialogProps {
  excludeFolderId?: string;
  mode: "add" | "move";
  onOpenChange: (open: boolean) => void;
  onPick: (folder: FolderSummary) => void;
  open: boolean;
  selectedCount: number;
}

export function FolderPickerDialog({
  excludeFolderId,
  mode,
  open,
  onOpenChange,
  onPick,
  selectedCount,
}: FolderPickerDialogProps) {
  const t = useTranslations("folders.picker");
  const tList = useTranslations("folders.list");
  const errors = useServerErrors();
  const listId = useId();
  const folders = useFolders();
  const createFolder = useMutation(api.folders.createFolder);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setError(null);
    }
  }, [open]);

  const matches = useMemo(
    () =>
      filterFolders(manualFolders(folders ?? []), query).filter(
        (folder) => folder._id !== excludeFolderId
      ),
    [excludeFolderId, folders, query]
  );
  const trimmed = query.trim();
  const isNewName =
    Boolean(trimmed) &&
    folders !== undefined &&
    !hasFolderNamed(folders, trimmed) &&
    explainInvalidFolderName(trimmed) === null;
  const atCap = (folders?.length ?? 0) >= MAX_FOLDERS_PER_USER;
  const canCreate = isNewName && !atCap;
  const optionCount = matches.length + (canCreate ? 1 : 0);

  const pick = (folder: FolderSummary) => {
    onOpenChange(false);
    onPick(folder);
  };

  const [create, isCreating] = useSingleFlight(async () => {
    if (!canCreate) {
      return;
    }
    setError(null);
    try {
      pick(await createFolder({ name: trimmed }));
    } catch (caught) {
      setError(errors.message(caught, tList("createFailed")));
    }
  });

  const choose = (index: number) => {
    if (index < matches.length) {
      pick(matches[index]);
    } else if (canCreate) {
      create().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (open) {
      document
        .getElementById(`${listId}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, listId, open]);

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>
            {mode === "add"
              ? t("addTitle", { count: selectedCount })
              : t("moveTitle", { count: selectedCount })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("description")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative border-y">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-activedescendant={
              optionCount > 0 ? optionId(activeIndex) : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-label={tList("searchLabel")}
            autoFocus
            className="h-11 rounded-none border-0 pl-11 shadow-none focus-visible:ring-0"
            maxLength={FOLDER_NAME_INPUT_MAX_LENGTH}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event)) {
                return;
              }
              if (event.key === "ArrowDown" && optionCount > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % optionCount);
              } else if (event.key === "ArrowUp" && optionCount > 0) {
                event.preventDefault();
                setActiveIndex(
                  (index) => (index - 1 + optionCount) % optionCount
                );
              } else if (event.key === "Enter" && optionCount > 0) {
                event.preventDefault();
                choose(activeIndex);
              }
            }}
            placeholder={tList("searchPlaceholder")}
            role="combobox"
            value={query}
          />
        </div>
        <div
          aria-label={tList("listLabel")}
          className="max-h-72 overflow-y-auto p-1.5"
          id={listId}
          role="listbox"
        >
          {folders === undefined && (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              {tList("loading")}
            </p>
          )}
          {folders !== undefined && optionCount === 0 && (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              {trimmed ? tList("noMatch") : tList("noFolders")}
            </p>
          )}
          {matches.map((folder, index) => (
            <button
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none",
                index === activeIndex && "bg-accent text-accent-foreground"
              )}
              id={optionId(index)}
              key={folder._id}
              onClick={() => pick(folder)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <FolderDot color={folder.color} />
              <span className="min-w-0 flex-1 truncate" title={folder.name}>
                {folder.name}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {folder.activeCardCount}
              </span>
            </button>
          ))}
          {canCreate ? (
            <button
              aria-selected={activeIndex === matches.length}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none",
                activeIndex === matches.length &&
                  "bg-accent text-accent-foreground"
              )}
              disabled={isCreating}
              id={optionId(matches.length)}
              onClick={() => create().catch(() => undefined)}
              onMouseEnter={() => setActiveIndex(matches.length)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <Plus
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">
                {tList("createNamed", { name: trimmed })}
              </span>
            </button>
          ) : null}
        </div>
        {error || (isNewName && atCap) ? (
          <p
            className="border-t px-5 py-3 text-destructive text-sm"
            role="alert"
          >
            {error ?? errors.byKey("folders.TOO_MANY_FOLDERS")}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
