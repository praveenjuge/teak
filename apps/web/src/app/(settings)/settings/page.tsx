"use client";

import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { runClientSpan } from "@teak/convex/shared/client-telemetry";
import { trackCheckout } from "@teak/convex/shared/metrics";
import { sanitizeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { Dialog, DialogContent } from "@teak/ui/components/ui/dialog";
import { getPolarPlanIds } from "@teak/ui/constants/billing";
import { TOAST_IDS } from "@teak/ui/constants/toast";
import { useSettingsController } from "@teak/ui/hooks";
import { SettingsContent, SubscriptionSection } from "@teak/ui/settings";
import { useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export default function ProfileSettingsPage() {
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const checkoutInstanceRef = useRef<PolarEmbedCheckout | null>(null);
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const { theme } = useTheme();
  const router = useRouter();

  useEffect(
    () => () => {
      checkoutInstanceRef.current?.close();
    },
    []
  );

  const settings = useSettingsController({
    onDeleteAccount: async () => {
      let deleteError: string | null = null;
      // The awaited call's onError callback assigns `deleteError`; the guard
      // below reads that side effect, so this await cannot be deferred past it.
      // react-doctor-disable-next-line react-doctor/async-defer-await
      await authClient.deleteUser(undefined, {
        onSuccess: async () => {
          router.push("/login");
        },
        onError: (ctx) => {
          deleteError = ctx.error?.message ?? "Failed to delete account.";
        },
      });

      if (deleteError) {
        throw new Error(deleteError);
      }
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
    onSignOut: async () => {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.refresh();
            router.push("/login");
          },
        },
      });
    },
  });

  const handleCheckout = async (planId: string) => {
    trackCheckout({ outcome: "start" });
    setLoadingPlanId(planId);
    const toastId = toast.loading("Opening checkout...", {
      id: TOAST_IDS.checkoutOpen,
    });

    try {
      const checkout = await runClientSpan(
        {
          name: "checkout.open",
          operation: "billing",
          stage: "checkout",
        },
        async () => {
          const checkoutUrl = await createCheckoutLink({ productId: planId });
          let effectiveTheme: "light" | "dark" = "light";
          if (theme === "dark") {
            effectiveTheme = "dark";
          } else if (theme === "system") {
            effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)")
              .matches
              ? "dark"
              : "light";
          }
          return await PolarEmbedCheckout.create(checkoutUrl, {
            theme: effectiveTheme,
          });
        }
      );
      trackCheckout({ outcome: "open" });
      toast.success("Checkout opened", { id: toastId });

      checkoutInstanceRef.current = checkout;
      setSubscriptionOpen(false);

      let completed = false;
      checkout.addEventListener(
        "success",
        (event: CustomEvent<{ redirect?: string | boolean }>) => {
          if (!completed) {
            completed = true;
            trackCheckout({ outcome: "success" });
          }
          if (!event.detail.redirect) {
            toast.success(
              "Welcome to Pro! Your subscription has been activated."
            );
          }
        }
      );

      checkout.addEventListener("close", () => {
        if (!completed) {
          trackCheckout({ outcome: "cancel" });
        }
        checkoutInstanceRef.current = null;
        toast("Checkout closed", { id: toastId });
      });
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
      cardCount={settings.cardCount}
      deleteDialogError={settings.deleteDialogError}
      deleteDialogOpen={settings.deleteDialogOpen}
      deleteLoading={settings.deleteLoading}
      email={settings.email}
      exportState={settings.exportState}
      hasPremium={settings.hasPremium}
      isLoading={settings.isLoading}
      keys={settings.keys}
      onCancelExport={settings.handleCancelExport}
      onCreateApiKey={settings.handleCreateApiKey}
      onCreateCustomerPortal={settings.handleCreateCustomerPortal}
      onDeleteAccount={settings.handleDeleteAccount}
      onDeleteDialogOpenChange={settings.setDeleteDialogOpen}
      onDownloadExport={settings.handleDownloadExport}
      onRevokeApiKey={settings.handleRevokeApiKey}
      onRotateApiKey={settings.handleRotateApiKey}
      onSignOut={settings.handleSignOut}
      onStartExport={settings.handleStartExport}
      onUpgrade={() => {
        setSubscriptionOpen(true);
      }}
      signOutLoading={settings.signOutLoading}
      subscriptionDialog={
        <Dialog onOpenChange={setSubscriptionOpen} open={subscriptionOpen}>
          <DialogContent className="max-w-3xl">
            <SubscriptionSection
              loadingPlanId={loadingPlanId}
              monthlyPlanId={planIds.monthly}
              onCheckout={handleCheckout}
              yearlyPlanId={planIds.yearly}
            />
          </DialogContent>
        </Dialog>
      }
    />
  );
}
