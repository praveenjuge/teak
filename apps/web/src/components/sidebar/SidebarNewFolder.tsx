"use client";

import { api } from "@teak/convex";
import {
  explainInvalidFolderName,
  FOLDER_ERROR_MESSAGES,
  MAX_FOLDERS_PER_USER,
} from "@teak/convex/shared/folders";
import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderSummary,
  folderErrorMessage,
  hasFolderNamed,
} from "../../lib/folders";
import { FolderDot } from "../folders/FolderDot";

interface SidebarNewFolderProps {
  folders: readonly FolderSummary[] | undefined;
  onDone: () => void;
}

export function SidebarNewFolder({ folders, onDone }: SidebarNewFolderProps) {
  const errorId = useId();
  const createFolder = useMutation(api.folders.createFolder);
  const [name, setName] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [create, isSaving] = useSingleFlight(async (folderName: string) => {
    try {
      await createFolder({ name: folderName });
      onDone();
    } catch (caught) {
      setServerError(folderErrorMessage(caught, "Couldn't create the folder"));
    }
  });

  const trimmed = name.trim();
  let problem: string | null = null;
  if (isSaving) {
    problem = null;
  } else if (folders && folders.length >= MAX_FOLDERS_PER_USER) {
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
    if (!problem) {
      await create(trimmed);
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
      {error ? (
        <p
          className="px-[9px] pt-1 pb-0.5 text-[11px] text-destructive leading-snug"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </SidebarMenuItem>
  );
}
