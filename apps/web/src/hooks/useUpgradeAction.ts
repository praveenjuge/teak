import { SETTINGS_PATHS } from "@teak/convex/shared/webRoutes";
import { useTranslations } from "@teak/i18n/react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { type ExternalToast, toast } from "sonner";
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "@/constants/toast";
import { isCardLimitError, isRateLimitError } from "@/lib/cardErrors";

export type CreateFailureKind = "cardLimit" | "rateLimited";

export interface CreateFailureToast extends ExternalToast {
  /** Said after the reason, such as which files were skipped. */
  note?: string;
}

const withNote = (message: string, note?: string) =>
  note ? `${message} ${note}` : message;

/**
 * Opening the plan page, and what a card that wasn't made says when a limit
 * stopped it: the free card limit (with an Upgrade button) or too many cards
 * made at once. Every way of making a card (the composer, uploads,
 * recordings, Save PDF) says these the same way.
 */
export function useUpgradeAction() {
  const router = useRouter();
  const tLimits = useTranslations("forms.limits");

  const handleUpgrade = useCallback(() => {
    router.push(SETTINGS_PATHS.plan);
  }, [router]);

  const showUpgradeToast = useCallback(
    (
      toastId: string | number = TOAST_IDS.cardLimit,
      { note, ...options }: CreateFailureToast = {}
    ) => {
      toast.error(withNote(tLimits("cardLimitReached"), note), {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        ...options,
        action: { label: tLimits("upgrade"), onClick: handleUpgrade },
        id: toastId,
      });
    },
    [handleUpgrade, tLimits]
  );

  /**
   * Says why a card wasn't made when a limit stopped it, and returns which
   * limit; `null`, with nothing shown, for any other failure.
   */
  const showCreateFailure = useCallback(
    (
      failure: unknown,
      { id, note, ...options }: CreateFailureToast = {}
    ): CreateFailureKind | null => {
      if (isCardLimitError(failure)) {
        showUpgradeToast(id, { note, ...options });
        return "cardLimit";
      }
      if (isRateLimitError(failure)) {
        toast.error(withNote(tLimits("rateLimited"), note), { ...options, id });
        return "rateLimited";
      }
      return null;
    },
    [showUpgradeToast, tLimits]
  );

  return { handleUpgrade, showCreateFailure, showUpgradeToast };
}
