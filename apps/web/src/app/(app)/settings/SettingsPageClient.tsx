"use client";

import { api } from "@teak/convex";
import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type ImportExportOpenRequest,
  SettingsContent,
  SubscriptionDialog,
} from "@/components/settings";
import { getPolarPlanIds } from "@/constants/billing";
import { TOAST_IDS } from "@/constants/toast";
import { useSettingsController } from "@/hooks";
import { reserveCheckoutTab } from "@/lib/checkout-tab";
import { parseSettingsDialogParam } from "@/lib/commandPalette";
import { useQuery } from "@/lib/convexQueryHooks";
import { signOut } from "@/lib/sign-out-client";

function useConsumeDialogParam() {
  const router = useRouter();
  const dialogParam = useSearchParams().get("dialog");
  const [request, setRequest] = useState<ImportExportOpenRequest | null>(null);
  useEffect(() => {
    if (dialogParam === null) {
      return;
    }
    const tab = parseSettingsDialogParam(dialogParam);
    if (tab) {
      setRequest({ id: Date.now(), tab });
    }
    router.replace("/settings", { scroll: false });
  }, [dialogParam, router]);
  return request;
}

export function SettingsPageClient() {
  const t = useTranslations("app.settings");
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const checkoutOpenedRef = useRef(false);
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const deleteMyAccount = useMutation(api.accountDeletion.deleteMyAccount);
  const inboundEmail = useQuery(api.inbound.settings.getMine, {});
  const enableInboundEmail = useMutation(api.inbound.settings.enable);
  const disableInboundEmail = useMutation(api.inbound.settings.disable);
  const importExportRequest = useConsumeDialogParam();

  const settings = useSettingsController({
    onDeleteAccount: async () => {
      await deleteMyAccount({});
      toast.success(t("deletionRequested"));
      await signOut();
    },
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

  useEffect(() => {
    if (!(settings.hasPremium && checkoutOpenedRef.current)) {
      return;
    }
    checkoutOpenedRef.current = false;
    toast.success(t("welcomePro"));
  }, [settings.hasPremium, t]);

  const handleCheckout = async (planId: string) => {
    const checkoutTab = reserveCheckoutTab({
      assign: (url) => window.location.assign(url),
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
      setSubscriptionOpen(false);
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

  return (
    <SettingsContent
      accountLoading={settings.accountLoading}
      cardCount={settings.cardCount}
      connectionIdentity={settings.connectionIdentity}
      deleteDialogError={settings.deleteDialogError}
      deleteDialogOpen={settings.deleteDialogOpen}
      deleteLoading={settings.deleteLoading}
      email={settings.email}
      exportState={settings.exportState}
      hasPremium={settings.hasPremium}
      importExportRequest={importExportRequest}
      inboundEmail={{
        onDisable: () => disableInboundEmail({}),
        onEnable: () => enableInboundEmail({}),
        state: inboundEmail,
      }}
      keys={settings.keys}
      onCancelExport={settings.handleCancelExport}
      onCreateApiKey={settings.handleCreateApiKey}
      onCreateCustomerPortal={settings.handleCreateCustomerPortal}
      onDeleteAccount={settings.handleDeleteAccount}
      onDeleteDialogOpenChange={settings.setDeleteDialogOpen}
      onDownloadExport={settings.handleDownloadExport}
      onLoadMoreSessions={settings.loadMoreSessions}
      onRetrySessions={settings.retrySessions}
      onRevokeAllApiKeys={settings.handleRevokeAllApiKeys}
      onRevokeApiKey={settings.handleRevokeApiKey}
      onRevokeOAuthConnection={settings.handleRevokeOAuthConnection}
      onRevokeSession={settings.handleRevokeSession}
      onRotateApiKey={settings.handleRotateApiKey}
      onSignOut={settings.handleSignOut}
      onStartExport={settings.handleStartExport}
      onUpgrade={() => {
        setSubscriptionOpen(true);
      }}
      sessions={settings.sessions}
      sessionsError={settings.sessionsError}
      sessionsHasMore={settings.sessionsHasMore}
      sessionsLoadingMore={settings.sessionsLoadingMore}
      signOutLoading={settings.signOutLoading}
      subscriptionDialog={
        <SubscriptionDialog
          loadingPlanId={loadingPlanId}
          monthlyPlanId={planIds.monthly}
          onCheckout={handleCheckout}
          onOpenChange={setSubscriptionOpen}
          open={subscriptionOpen}
          yearlyPlanId={planIds.yearly}
        />
      }
    />
  );
}
