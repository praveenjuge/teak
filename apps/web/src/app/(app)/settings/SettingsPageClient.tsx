"use client";

import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { runClientSpan } from "@teak/convex/shared/client-telemetry";
import { trackCheckout } from "@teak/convex/shared/metrics";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { getPolarPlanIds } from "@teak/ui/constants/billing";
import { TOAST_IDS } from "@teak/ui/constants/toast";
import { useSettingsController } from "@teak/ui/hooks";
import { SettingsContent, SubscriptionDialog } from "@teak/ui/settings";
import { useAction, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { openCheckoutInNewTab } from "@/lib/checkout-tab";
import { signOut } from "@/lib/sign-out-client";

export function SettingsPageClient() {
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  // Checkout runs in another tab, so success shows up here as the plan
  // turning Pro once Polar's webhook lands.
  const checkoutOpenedRef = useRef(false);
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const deleteMyAccount = useMutation(api.accountDeletion.deleteMyAccount);

  const settings = useSettingsController({
    onDeleteAccount: async () => {
      await deleteMyAccount({});
      toast.success("Account deletion requested. You’re being signed out.");
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
    trackCheckout({ outcome: "success" });
    toast.success("Welcome to Pro! Your subscription has been activated.");
  }, [settings.hasPremium]);

  const handleCheckout = async (planId: string) => {
    trackCheckout({ outcome: "start" });
    setLoadingPlanId(planId);
    const toastId = toast.loading("Opening checkout...", {
      id: TOAST_IDS.checkoutOpen,
    });

    try {
      // Runs synchronously up to its first await, inside the click.
      const openedIn = await openCheckoutInNewTab({
        assign: (url) => window.location.assign(url),
        createCheckoutUrl: () =>
          runClientSpan(
            {
              name: "checkout.open",
              operation: "billing",
              stage: "checkout",
            },
            () => createCheckoutLink({ productId: planId })
          ),
        openWindow: (url, target) => window.open(url, target),
      });
      trackCheckout({ outcome: "open" });
      checkoutOpenedRef.current = true;
      setSubscriptionOpen(false);
      if (openedIn === "new-tab") {
        toast.success("Checkout opened in a new tab", { id: toastId });
      } else {
        toast.dismiss(toastId);
      }
    } catch (error) {
      trackCheckout({ outcome: "failure" });
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCheckoutLink" },
      });
      toast.error("Failed to start checkout. Please try again.", {
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
