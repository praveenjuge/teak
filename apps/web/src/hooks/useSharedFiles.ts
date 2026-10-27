"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { takeSharedFiles } from "@/lib/share/sharedFiles";

// The share sheet opens the installed app in its own window. Any other page
// can also post a form to `/share`, so outside that window the files wait
// for the person to say they meant to save them.
const isInstalledAppWindow = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(display-mode: standalone)").matches === true;

/**
 * Uploads the files shared to the installed web app, which the service worker
 * kept under `id`, through the same queue as a drop. Says so when they're gone.
 */
export function useSharedFiles(id: string | null) {
  const t = useTranslations("providers.fileDrop");
  const tc = useTranslations("common");
  const fileDrop = useGlobalFileDrop();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!(id && fileDrop) || handled.current === id) {
      return;
    }
    handled.current = id;
    const storage = typeof caches === "undefined" ? undefined : caches;
    takeSharedFiles(storage, id)
      .catch(() => null)
      .then((files) => {
        if (!files) {
          toast.error(t("sharedFilesMissing"));
        } else if (isInstalledAppWindow()) {
          fileDrop.enqueueFiles(files);
        } else {
          toast(t("sharedFilesConfirm", { count: files.length }), {
            ...MANUAL_CLOSE_TOAST_OPTIONS,
            action: {
              label: tc("save"),
              onClick: () => fileDrop.enqueueFiles(files),
            },
            id: `shared-files-${id}`,
          });
        }
      });
  }, [id, fileDrop, t, tc]);
}
