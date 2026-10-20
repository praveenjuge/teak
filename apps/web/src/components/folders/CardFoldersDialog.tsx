"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDERS_PER_CARD,
} from "@teak/convex/shared/folders";
import { useMutation } from "convex/react";
import { Check, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { updateCardsInSearchQueries } from "../../hooks/cardQueryOptimisticUpdates";
import { useFolders } from "../../hooks/useFolders";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  filterFolders,
  folderErrorMessage,
  hasFolderNamed,
  manualFolders,
} from "../../lib/folders";
import { cn } from "../../lib/utils";
import { FolderDot } from "./FolderDot";

interface CardFoldersDialogProps {
  cardId: string | null;
  folderIds: readonly string[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CardFoldersDialog({
  cardId,
  folderIds,
  open,
  onOpenChange,
}: CardFoldersDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <CardFoldersChecklist cardId={cardId} initialFolderIds={folderIds} />
      </DialogContent>
    </Dialog>
  );
}

function CardFoldersChecklist({
  cardId,
  initialFolderIds,
}: {
  cardId: string | null;
  initialFolderIds: readonly string[];
}) {
  const folders = useFolders();
  const createFolder = useMutation(api.folders.createFolder);
  const setCardFolders = useMutation(
    api.folders.setCardFolders
  ).withOptimisticUpdate((localStore, args) => {
    updateCardsInSearchQueries(localStore, new Set([args.cardId]), (card) => ({
      ...card,
      folderIds: args.folderIds.length > 0 ? args.folderIds : undefined,
      updatedAt: Date.now(),
    }));
  });
  const [query, setQuery] = useState("");
  const [checked, setCheckedState] = useState(() => [...initialFolderIds]);
  const checkedRef = useRef(checked);
  const setChecked = (next: string[]) => {
    checkedRef.current = next;
    setCheckedState(next);
  };
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => filterFolders(manualFolders(folders ?? []), query),
    [folders, query]
  );
  const trimmed = query.trim();
  const canCreate =
    Boolean(trimmed) &&
    folders !== undefined &&
    !hasFolderNamed(folders, trimmed) &&
    explainInvalidFolderName(trimmed) === null;

  const save = async (next: string[]) => {
    if (!cardId) {
      return;
    }
    const previous = checkedRef.current;
    setChecked(next);
    setError(null);
    try {
      await setCardFolders({
        cardId: cardId as Id<"cards">,
        folderIds: next as Id<"folders">[],
      });
    } catch (caught) {
      setChecked(previous);
      setError(
        folderErrorMessage(caught, "Couldn't change the card's folders")
      );
    }
  };

  const toggle = (folderId: string) => {
    const current = checkedRef.current;
    if (current.includes(folderId)) {
      save(current.filter((id) => id !== folderId)).catch(() => undefined);
      return;
    }
    if (current.length >= MAX_FOLDERS_PER_CARD) {
      setError(FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS_ON_CARD);
      return;
    }
    save([...current, folderId]).catch(() => undefined);
  };

  const [create] = useSingleFlight(async () => {
    if (!canCreate) {
      return;
    }
    if (checkedRef.current.length >= MAX_FOLDERS_PER_CARD) {
      setError(FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS_ON_CARD);
      return;
    }
    try {
      const folder = await createFolder({ name: trimmed });
      setQuery("");
      await save([...checkedRef.current, folder._id]);
    } catch (caught) {
      setError(folderErrorMessage(caught, "Couldn't create the folder"));
    }
  });

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3">
        <DialogTitle>Folders</DialogTitle>
        <DialogDescription>
          {checked.length === 0
            ? "This card isn't in a folder."
            : `In ${checked.length} ${checked.length === 1 ? "folder" : "folders"}.`}
        </DialogDescription>
      </DialogHeader>
      <div className="relative border-y">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search folders"
          autoFocus
          className="h-11 rounded-none border-0 pl-11 shadow-none focus-visible:ring-0"
          maxLength={FOLDER_NAME_INPUT_MAX_LENGTH}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            if (visible.length === 1) {
              toggle(visible[0]._id);
            } else if (canCreate) {
              create().catch(() => undefined);
            }
          }}
          placeholder="Find or create a folder"
          value={query}
        />
      </div>
      <ul aria-label="Folders" className="max-h-72 overflow-y-auto p-1.5">
        {folders === undefined && (
          <li className="px-3 py-6 text-center text-muted-foreground text-sm">
            Loading folders…
          </li>
        )}
        {folders !== undefined && visible.length === 0 && !canCreate && (
          <li className="px-3 py-6 text-center text-muted-foreground text-sm">
            {trimmed
              ? "No folder by that name."
              : "No folders yet. Type a name to create one."}
          </li>
        )}
        {visible.map((folder) => {
          const isChecked = checked.includes(folder._id);
          return (
            <li key={folder._id}>
              <button
                aria-pressed={isChecked}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => toggle(folder._id)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                    isChecked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input"
                  )}
                >
                  {isChecked && <Check className="size-3" />}
                </span>
                <FolderDot color={folder.color} />
                <span className="min-w-0 flex-1 truncate" title={folder.name}>
                  {folder.name}
                </span>
              </button>
            </li>
          );
        })}
        {canCreate ? (
          <li>
            <button
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => create().catch(() => undefined)}
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
          </li>
        ) : null}
      </ul>
      {error ? (
        <p className="border-t px-5 py-3 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
