"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { MANUAL_CLOSE_TOAST_OPTIONS } from "@/constants/toast";
import { discardSharedFiles, takeSharedFiles } from "@/lib/share/sharedFiles";

// The share sheet opens the installed app in its own window. Any other page
// can also post a form to `/share`, so outside that window the files wait
// for the person to say they meant to save them.
const isInstalledAppWindow = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(display-mode: standalone)").matches === true;

const shareStorage = () => (typeof caches === "undefined" ? undefined : caches);

// The library drops `share=<id>` from the address as it opens, so a share
// that waits for Save is remembered for this tab, where a reload finds it.
const PENDING_SHARE_KEY = "teak:pending-share";

const readPendingShare = (): string | null => {
  try {
    return window.sessionStorage.getItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
};

const rememberPendingShare = (id: string | null) => {
  try {
    if (id) {
      window.sessionStorage.setItem(PENDING_SHARE_KEY, id);
    } else {
      window.sessionStorage.removeItem(PENDING_SHARE_KEY);
    }
  } catch {
    // Without storage, a reload before Save loses the share.
  }
};

const settleShare = (storage: CacheStorage | undefined, id: string) => {
  rememberPendingShare(null);
  discardSharedFiles(storage, id).catch(() => undefined);
};

export function useSharedFiles(id: string | null) {
  const t = useTranslations("providers.fileDrop");
  const tc = useTranslations("common");
  const fileDrop = useGlobalFileDrop();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const shareId = id ?? readPendingShare();
    if (!(shareId && fileDrop) || handled.current === shareId) {
      return;
    }
    handled.current = shareId;
    const storage = shareStorage();
    const ask = !isInstalledAppWindow();
    takeSharedFiles(storage, shareId, { keep: ask })
      .catch(() => null)
      .then((files) => {
        if (!files) {
          rememberPendingShare(null);
          toast.error(t("sharedFilesMissing"));
          return;
        }
        if (!ask) {
          fileDrop.enqueueFiles(files);
          return;
        }
        rememberPendingShare(shareId);
        const settle = () => settleShare(storage, shareId);
        toast(t("sharedFilesConfirm", { count: files.length }), {
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          action: {
            label: tc("save"),
            onClick: () => {
              settle();
              fileDrop.enqueueFiles(files);
            },
          },
          id: `shared-files-${shareId}`,
          onDismiss: settle,
        });
      });
  }, [id, fileDrop, t, tc]);
}
