"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { withoutSharedFilesParam } from "@/lib/share/sharedContent";
import { discardSharedFiles, takeSharedFiles } from "@/lib/share/sharedFiles";

// The share sheet opens the installed app in its own window. Any other page
// can also post a form to `/share`, so outside that window the files wait
// for the person to say they meant to save them.
const isInstalledAppWindow = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(display-mode: standalone)").matches === true;

const shareStorage = () => (typeof caches === "undefined" ? undefined : caches);

// Drops `share=<id>` from the address once the files are handled, so a
// reload doesn't look for them again.
const forgetShareInUrl = () => {
  const query = withoutSharedFilesParam(window.location.search);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );
};

// Saved or turned down: the files and their id are no longer needed.
const settleShare = (storage: CacheStorage | undefined, id: string) => {
  forgetShareInUrl();
  discardSharedFiles(storage, id).catch(() => undefined);
};

/**
 * Uploads the files shared to the installed web app, which the service worker
 * kept under `id`, through the same queue as a drop. Says so when they're gone.
 * In a browser tab it asks first, and keeps the files and the id in the URL
 * until they're saved or turned down, so a reload asks again.
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
    const storage = shareStorage();
    const ask = !isInstalledAppWindow();
    takeSharedFiles(storage, id, { keep: ask })
      .catch(() => null)
      .then((files) => {
        if (!files) {
          forgetShareInUrl();
          toast.error(t("sharedFilesMissing"));
          return;
        }
        if (!ask) {
          forgetShareInUrl();
          fileDrop.enqueueFiles(files);
          return;
        }
        const settle = () => settleShare(storage, id);
        toast(t("sharedFilesConfirm", { count: files.length }), {
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          action: {
            label: tc("save"),
            onClick: () => {
              settle();
              fileDrop.enqueueFiles(files);
            },
          },
          id: `shared-files-${id}`,
          onDismiss: settle,
        });
      });
  }, [id, fileDrop, t, tc]);
}
