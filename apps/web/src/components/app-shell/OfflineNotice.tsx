"use client";

import { useTranslations } from "@teak/i18n/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { TOAST_IDS } from "@/constants/toast";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/**
 * Says so while the browser is offline: changes made meanwhile show at once
 * and save on reconnecting, which a spinning "Saving…" alone doesn't tell.
 */
export function OfflineNotice() {
  const t = useTranslations("appShell");
  const { isOnline } = useNetworkStatus();
  useEffect(() => {
    if (isOnline) {
      toast.dismiss(TOAST_IDS.offline);
      return;
    }
    toast.warning(t("offline"), {
      duration: Number.POSITIVE_INFINITY,
      id: TOAST_IDS.offline,
    });
  }, [isOnline, t]);
  return null;
}
