"use client";

import { api } from "@teak/convex";
import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { InboundEmailPanelProps } from "@/components/settings";
import type { PlanCheckout } from "@/components/settings/PlanSettings";
import { getPolarPlanIds } from "@/constants/billing";
import { TOAST_IDS } from "@/constants/toast";
import { useSettingsController } from "@/hooks";
import {
  type LanguageSetting,
  useLanguageSetting,
} from "@/hooks/useLanguageSetting";
import { deleteAccountAndLeave } from "@/lib/accountDeletion";
import { reserveCheckoutTab } from "@/lib/checkout-tab";
import { useQuery } from "@/lib/convexQueryHooks";
import { signOut } from "@/lib/sign-out-client";

interface SettingsContextValue {
  checkout: PlanCheckout;
  inboundEmail: InboundEmailPanelProps;
  language: LanguageSetting | null;
  settings: ReturnType<typeof useSettingsController>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return value;
}

function useCheckout(hasPremium: boolean | undefined): PlanCheckout {
  const t = useTranslations("app.settings");
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const checkoutOpenedRef = useRef(false);
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);

  useEffect(() => {
    if (!(hasPremium && checkoutOpenedRef.current)) {
      return;
    }
    checkoutOpenedRef.current = false;
    toast.success(t("welcomePro"));
  }, [hasPremium, t]);

  const onCheckout = async (planId: string) => {
    const checkoutTab = reserveCheckoutTab({
      assign: (url) => {
        window.location.assign(url);
      },
      openWindow: (url, target) => window.open(url, target),
    });
    captureEvent("checkout_started");
    setLoadingPlanId(planId);
    const toastId = toast.loading(t("openingCheckout"), {
      id: TOAST_IDS.checkoutOpen,
    });

    try {
      const openedIn = await checkoutTab.navigate(() =>
        createCheckoutLink({ productId: planId })
      );
      captureEvent("checkout_opened");
      checkoutOpenedRef.current = true;
      if (openedIn === "new-tab") {
        toast.success(t("checkoutNewTab"), { id: toastId });
      } else {
        toast.dismiss(toastId);
      }
    } catch (error) {
      captureClientException(error, {
        operation: "billing.create_checkout_link",
      });
      toast.error(t("checkoutFailed"), {
        id: toastId,
      });
    }
    setLoadingPlanId(null);
  };

  const planIds = getPolarPlanIds(
    process.env.NODE_ENV === "production" ? "production" : "development"
  );

  return {
    loadingPlanId,
    monthlyPlanId: planIds.monthly,
    onCheckout: (planId) => {
      void onCheckout(planId);
    },
    yearlyPlanId: planIds.yearly,
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("app.settings");
  const deleteMyAccount = useMutation(api.accountDeletion.deleteMyAccount);
  const inboundEmail = useQuery(api.inbound.settings.getMine, {});
  const enableInboundEmail = useMutation(api.inbound.settings.enable);
  const disableInboundEmail = useMutation(api.inbound.settings.disable);
  const language = useLanguageSetting();

  const settings = useSettingsController({
    onDeleteAccount: () =>
      deleteAccountAndLeave({
        deleteAccount: () => deleteMyAccount({}),
        leave: () => window.location.assign("/sign-in"),
        onDeleted: () => toast.success(t("deletionRequested")),
        signOut,
      }),
    onOpenExternal: (url) => {
      const safeUrl = sanitizeExternalUrl(url);
      if (!safeUrl) {
        throw new Error("Invalid portal URL");
      }
      window.location.assign(safeUrl);
    },
    onDownloadFile: (url) => {
      // Use an anchor click rather than window.open: the artifact is served
      // with Content-Disposition: attachment, and an anchor click is not
      // blocked by the popup blocker after an awaited action call.
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.target = "_blank";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onSignOut: signOut,
  });
  const checkout = useCheckout(settings.hasPremium);

  return (
    <SettingsContext.Provider
      value={{
        checkout,
        inboundEmail: {
          onDisable: () => disableInboundEmail({}),
          onEnable: () => enableInboundEmail({}),
          state: inboundEmail,
        },
        language,
        settings,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
