"use client";

import { api } from "@teak/convex";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_USER,
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
import { useMutation } from "convex/react";
import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useFolders } from "../../hooks/useFolders";
import {
  FOLDER_COLOR_LABELS,
  FOLDER_COLORS,
  FOLDER_DOT_CLASSES,
  type FolderColor,
  type FolderSummary,
  folderErrorMessage,
  hasFolderNamed,
} from "../../lib/folders";
import { cn } from "../../lib/utils";

interface FolderNameDialogProps {
  /** The folder to rename; omit to create one. */
  folder?: FolderSummary | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the folder once it is saved. */
  onSaved?: (folder: FolderSummary) => void;
  open: boolean;
}

/** Names a new folder, or renames and recolors an existing one. */
export function FolderNameDialog({
  folder,
  open,
  onOpenChange,
  onSaved,
}: FolderNameDialogProps) {
  const inputId = useId();
  const folders = useFolders();
  const createFolder = useMutation(api.folders.createFolder);
  const updateFolder = useMutation(api.folders.updateFolder);
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor | undefined>(undefined);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Blocks a second submit before the disabled button has rendered.
  const savingRef = useRef(false);
  const isRename = Boolean(folder);

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setColor(folder?.color);
      setServerError(null);
      setIsSaving(false);
      savingRef.current = false;
    }
  }, [folder, open]);

  const trimmed = name.trim();
  let problem: string | null = null;
  if (!isRename && folders && folders.length >= MAX_FOLDERS_PER_USER) {
    problem = FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS;
  } else if (folders && hasFolderNamed(folders, trimmed, folder?._id)) {
    problem = FOLDER_ERROR_MESSAGES.DUPLICATE_NAME;
  } else if (trimmed) {
    problem = explainInvalidFolderName(trimmed);
  }
  const error = problem ?? serverError;
  const unchanged =
    isRename && trimmed === folder?.name && color === folder?.color;
  const canSubmit = Boolean(trimmed) && !problem && !isSaving && !unchanged;

  const submit = async () => {
    if (!canSubmit || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setServerError(null);
    try {
      const saved = folder
        ? await updateFolder({
            folderId: folder._id,
            name: trimmed,
            color: color ?? null,
          })
        : await createFolder({ name: trimmed, ...(color ? { color } : {}) });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (caught) {
      setServerError(
        folderErrorMessage(
          caught,
          isRename ? "Couldn't rename the folder" : "Couldn't create the folder"
        )
      );
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isRename ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isRename
              ? "Change the folder's name or color."
              : "Name the folder and pick a color."}
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
              autoFocus
              id={inputId}
              maxLength={MAX_FOLDER_NAME_LENGTH}
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
            <Button disabled={!canSubmit} type="submit">
              {isRename ? "Save" : "Create folder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
