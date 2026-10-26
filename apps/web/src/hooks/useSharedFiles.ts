"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { takeSharedFiles } from "@/lib/share/sharedFiles";

/**
 * Uploads the files shared to the installed web app, which the service worker
 * kept under `id`, through the same queue as a drop. Says so when they're gone.
 */
export function useSharedFiles(id: string | null) {
  const t = useTranslations("providers.fileDrop");
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
        if (files) {
          fileDrop.enqueueFiles(files);
        } else {
          toast.error(t("sharedFilesMissing"));
        }
      });
  }, [id, fileDrop, t]);
}
