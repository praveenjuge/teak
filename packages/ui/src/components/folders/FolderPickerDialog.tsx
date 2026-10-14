"use client";

import { api } from "@teak/convex";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDERS_PER_USER,
} from "@teak/convex/shared/folders";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Input } from "@teak/ui/components/ui/input";
import { useMutation } from "convex/react";
import { Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFolders } from "../../hooks/useFolders";
import { cardCountLabel } from "../../lib/bulkCardActions";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderSummary,
  filterFolders,
  folderErrorMessage,
  hasFolderNamed,
  manualFolders,
} from "../../lib/folders";
import { cn } from "../../lib/utils";
import { FolderDot } from "./FolderDot";

interface FolderPickerDialogProps {
  /** A folder to leave out, such as the one being viewed when moving. */
  excludeFolderId?: string;
  mode: "add" | "move";
  onOpenChange: (open: boolean) => void;
  onPick: (folder: FolderSummary) => void;
  open: boolean;
  selectedCount: number;
}

/**
 * Picks the folder a bulk Add or Move puts cards in. Typing filters the
 * folders; a name that matches none can be created on the spot.
 */
export function FolderPickerDialog({
  excludeFolderId,
  mode,
  open,
  onOpenChange,
  onPick,
  selectedCount,
}: FolderPickerDialogProps) {
  const listId = useId();
  const folders = useFolders();
  const createFolder = useMutation(api.folders.createFolder);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Blocks a second Enter before the disabled option has rendered.
  const creatingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setError(null);
      setIsCreating(false);
      creatingRef.current = false;
    }
  }, [open]);

  const matches = useMemo(
    () =>
      // Cards can't be put in a smart folder, so it is never offered.
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

  const create = async () => {
    if (!canCreate || creatingRef.current) {
      return;
    }
    creatingRef.current = true;
    setIsCreating(true);
    setError(null);
    try {
      pick(await createFolder({ name: trimmed }));
    } catch (caught) {
      setError(folderErrorMessage(caught, "Couldn't create the folder"));
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  const choose = (index: number) => {
    if (index < matches.length) {
      pick(matches[index]);
    } else if (canCreate) {
      create().catch(() => undefined);
    }
  };

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (open) {
      document
        .getElementById(`${listId}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, listId, open]);

  const verb = mode === "add" ? "Add" : "Move";
  const cards = cardCountLabel(selectedCount);
  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>
            {verb} {cards} to a folder
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search your folders or type a new name.
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
            aria-label="Search folders"
            autoFocus
            className="h-11 rounded-none border-0 pl-11 shadow-none focus-visible:ring-0"
            maxLength={FOLDER_NAME_INPUT_MAX_LENGTH}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setError(null);
            }}
            onKeyDown={(event) => {
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
            placeholder="Find or create a folder"
            role="combobox"
            value={query}
          />
        </div>
        <div
          aria-label="Folders"
          className="max-h-72 overflow-y-auto p-1.5"
          id={listId}
          role="listbox"
        >
          {folders === undefined && (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              Loading folders…
            </p>
          )}
          {folders !== undefined && optionCount === 0 && (
            <p className="px-3 py-6 text-center text-muted-foreground text-sm">
              {trimmed
                ? "No folder by that name."
                : "No folders yet. Type a name to create one."}
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
          {canCreate && (
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
                Create folder “{trimmed}”
              </span>
            </button>
          )}
        </div>
        {(error || (isNewName && atCap)) && (
          <p
            className="border-t px-5 py-3 text-destructive text-sm"
            role="alert"
          >
            {error ?? FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
