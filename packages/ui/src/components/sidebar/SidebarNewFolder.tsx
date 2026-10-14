"use client";

import { api } from "@teak/convex";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDERS_PER_USER,
} from "@teak/convex/shared/folders";
import { SidebarMenuItem } from "@teak/ui/components/ui/sidebar";
import { useMutation } from "convex/react";
import { useId, useRef, useState } from "react";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderSummary,
  folderErrorMessage,
  hasFolderNamed,
} from "../../lib/folders";
import { FolderDot } from "../folders/FolderDot";

interface SidebarNewFolderProps {
  folders: readonly FolderSummary[] | undefined;
  /** Called once the row is done: the folder was created or the user left. */
  onDone: () => void;
}

/**
 * A new folder named in place, as a row in the Folders list. Enter creates
 * it, Escape (or leaving it empty) cancels; a problem with the name shows
 * under the row and keeps it open.
 */
export function SidebarNewFolder({ folders, onDone }: SidebarNewFolderProps) {
  const errorId = useId();
  const createFolder = useMutation(api.folders.createFolder);
  const [name, setName] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const trimmed = name.trim();
  let problem: string | null = null;
  if (folders && folders.length >= MAX_FOLDERS_PER_USER) {
    problem = FOLDER_ERROR_MESSAGES.TOO_MANY_FOLDERS;
  } else if (folders && hasFolderNamed(folders, trimmed)) {
    problem = FOLDER_ERROR_MESSAGES.DUPLICATE_NAME;
  } else if (trimmed) {
    problem = explainInvalidFolderName(trimmed);
  }
  const error = problem ?? serverError;

  const submit = async () => {
    if (!trimmed) {
      onDone();
      return;
    }
    if (problem || savingRef.current) {
      return;
    }
    savingRef.current = true;
    try {
      await createFolder({ name: trimmed });
      onDone();
    } catch (caught) {
      savingRef.current = false;
      setServerError(folderErrorMessage(caught, "Couldn't create the folder"));
    }
  };

  return (
    <SidebarMenuItem>
      <form
        className="flex h-7 items-center gap-2 rounded-md bg-sidebar-accent/70 px-[9px] ring-1 ring-sidebar-ring/40"
        onSubmit={(event) => {
          event.preventDefault();
          submit().catch(() => undefined);
        }}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          <FolderDot className="size-[7px]" />
        </span>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          aria-label="New folder name"
          autoComplete="off"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40"
          maxLength={FOLDER_NAME_INPUT_MAX_LENGTH}
          onBlur={() => {
            // Leaving an empty or unchanged row is a cancel; a valid name
            // is kept, as if Enter were pressed.
            if (!trimmed || error) {
              if (!trimmed) {
                onDone();
              }
              return;
            }
            submit().catch(() => undefined);
          }}
          onChange={(event) => {
            setName(event.target.value);
            setServerError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onDone();
            }
          }}
          placeholder="Folder name"
          value={name}
        />
      </form>
      {error && (
        <p
          className="px-[9px] pt-1 pb-0.5 text-[11px] text-destructive leading-snug"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      )}
    </SidebarMenuItem>
  );
}
