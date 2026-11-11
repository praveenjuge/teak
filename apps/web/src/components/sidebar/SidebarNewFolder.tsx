"use client";

import { useTranslations } from "@teak/i18n/react";
import { useId, useState } from "react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { useCreateFolder } from "@/hooks/useFolderMutations";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useSingleFlight } from "../../hooks/useSingleFlight";
import {
  FOLDER_NAME_INPUT_MAX_LENGTH,
  type FolderSummary,
  folderNameProblem,
} from "../../lib/folders";
import { FolderDot } from "../folders/FolderDot";

interface SidebarNewFolderProps {
  folders: readonly FolderSummary[] | undefined;
  onDone: () => void;
}

export function SidebarNewFolder({ folders, onDone }: SidebarNewFolderProps) {
  const t = useTranslations("sidebar.newFolder");
  const errors = useServerErrors();
  const errorId = useId();
  const createFolder = useCreateFolder();
  const [name, setName] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [create, isSaving] = useSingleFlight(async (folderName: string) => {
    try {
      await createFolder({ name: folderName });
      onDone();
    } catch (caught) {
      setServerError(errors.message(caught, t("createFailed")));
    }
  });

  const trimmed = name.trim();
  const problem = isSaving ? null : folderNameProblem(folders, trimmed);
  const error = problem ? errors.byEnglishMessage(problem) : serverError;

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
          aria-label={t("nameLabel")}
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
          placeholder={t("placeholder")}
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
