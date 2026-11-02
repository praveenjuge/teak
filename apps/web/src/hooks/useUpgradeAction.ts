import { useTranslations } from "@teak/i18n/react";
import { useCallback } from "react";
import { toast } from "sonner";
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "@/constants/toast";

/**
 * Opening the plan page (or the caller's own upgrade flow), and the
 * "card limit reached" toast whose Upgrade button does it.
 */
export function useUpgradeAction(
  onUpgrade: (() => void) | undefined,
  upgradeUrl: string | undefined
) {
  const tLimits = useTranslations("forms.limits");

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    if (upgradeUrl && typeof window !== "undefined") {
      window.location.assign(upgradeUrl);
    }
  }, [onUpgrade, upgradeUrl]);

  const showUpgradeToast = useCallback(
    (toastId: string | number = TOAST_IDS.cardLimit) => {
      toast.error(tLimits("cardLimitReached"), {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        action: { label: tLimits("upgrade"), onClick: handleUpgrade },
        id: toastId,
      });
    },
    [handleUpgrade, tLimits]
  );

  return { handleUpgrade, showUpgradeToast };
}
