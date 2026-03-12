"use client";

import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { Dialog, DialogContent } from "@teak/ui/components/ui/dialog";
import { TOAST_IDS } from "@teak/ui/constants/toast";
import { useQuery } from "@teak/ui/convex-query-hooks";
import { openCustomerPortal } from "@teak/ui/lib/customerPortal";
import { SettingsContent, SubscriptionSection } from "@teak/ui/settings";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

const convexApi = api as any;

export default function ProfileSettingsPage() {
  const user = useQuery(api.auth.getCurrentUser);
  const cardCount = user?.cardCount ?? 0;
  const hasPremium = user?.hasPremium;
  const deleteAccount = useMutation(api.auth.deleteAccount);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [checkoutInstance, setCheckoutInstance] =
    useState<PolarEmbedCheckout | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);
  const { theme } = useTheme();
  const router = useRouter();

  const keys = useQuery(convexApi.apiKeys.listUserApiKeys, {}) as
    | { id: string }[]
    | undefined;
  const createKey = useMutation(convexApi.apiKeys.createUserApiKey);

  useEffect(() => {
    return () => {
      checkoutInstance?.close();
    };
  }, [checkoutInstance]);

  const handleCheckout = async (planId: string) => {
    setLoadingPlanId(planId);
    const toastId = toast.loading("Opening checkout...", {
      id: TOAST_IDS.checkoutOpen,
    });

    try {
      const checkoutUrl = await createCheckoutLink({ productId: planId });
      posthog.capture("subscription_checkout_started", { plan_id: planId });

      let effectiveTheme: "light" | "dark" = "light";
      if (theme === "dark") {
        effectiveTheme = "dark";
      } else if (theme === "system") {
        effectiveTheme = window.matchMedia("(prefers-color-scheme: dark)")
          .matches
          ? "dark"
          : "light";
      }

      const checkout = await PolarEmbedCheckout.create(checkoutUrl, {
        theme: effectiveTheme,
      });
      toast.success("Checkout opened", { id: toastId });

      setCheckoutInstance(checkout);
      setSubscriptionOpen(false);

      checkout.addEventListener(
        "success",
        (event: CustomEvent<{ redirect?: string | boolean }>) => {
          posthog.capture("subscription_activated", { plan_id: planId });
          if (!event.detail.redirect) {
            toast.success(
              "Welcome to Pro! Your subscription has been activated."
            );
          }
        }
      );

      checkout.addEventListener("close", () => {
        setCheckoutInstance(null);
        toast("Checkout closed", { id: toastId });
      });
    } catch (error) {
      console.error("Failed to open checkout", error);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCheckoutLink" },
      });
      posthog.captureException(error);
      toast.error("Failed to start checkout. Please try again.", {
        id: toastId,
      });
    } finally {
      setLoadingPlanId(null);
    }
  };

  const isLoading = user === undefined;
  const isProduction = process.env.NODE_ENV === "production";
  const monthlyPlanId = isProduction
    ? "d46c71a7-61dc-4dc8-b53d-9a73d0204c28"
    : "a02153cd-c49d-49ae-8be6-464296a39a23";
  const yearlyPlanId = isProduction
    ? "6fb24b68-09e0-42c4-b090-f0e03cb7de56"
    : "f3073c34-8b4d-40b7-8123-2f8cbacbc609";

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await deleteAccount({});

      await authClient.deleteUser(undefined, {
        onSuccess: async () => {
          posthog.capture("account_deleted");
          posthog.reset();
          router.push("/login");
        },
        onError: (ctx) => {
          setDeleteError(ctx.error?.message ?? "Failed to delete account.");
          setDeleteLoading(false);
        },
      });
    } catch {
      setDeleteError("Something went wrong while deleting your account.");
      setDeleteLoading(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutLoading(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            posthog.capture("user_logged_out");
            posthog.reset();
            router.refresh();
            router.push("/login");
          },
        },
      });
    } catch {
      toast.error("Failed to sign out. Please try again.");
    } finally {
      setSignOutLoading(false);
    }
  };

  const handleCreateApiKey = async () => {
    const result = (await createKey({ name: "API Keys" })) as { key: string };
    posthog.capture("api_key_created");
    return result;
  };

  const handleCreateCustomerPortal = async () => {
    const toastId = toast.loading("Opening customer portal...", {
      id: TOAST_IDS.customerPortal,
    });

    try {
      await openCustomerPortal({
        createCustomerPortal: () => createCustomerPortal({}),
        openWindow: (url, target, features) =>
          window.open(url, target, features),
      });
      posthog.capture("customer_portal_opened");
      toast.success("Customer portal opened", { id: toastId });
    } catch (error) {
      console.error("Failed to open customer portal", error);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCustomerPortal" },
      });
      posthog.captureException(error);
      toast.error("Could not open portal", { id: toastId });
    }
  };

  return (
    <SettingsContent
      cardCount={cardCount}
      deleteDialogError={deleteError}
      deleteDialogOpen={deleteDialogOpen}
      deleteLoading={deleteLoading}
      email={user?.email}
      hasPremium={hasPremium}
      isLoading={isLoading}
      keys={keys}
      onCreateApiKey={handleCreateApiKey}
      onCreateCustomerPortal={handleCreateCustomerPortal}
      onDeleteAccount={handleDeleteAccount}
      onDeleteDialogOpenChange={setDeleteDialogOpen}
      onSignOut={handleSignOut}
      onUpgrade={() => {
        setSubscriptionOpen(true);
      }}
      signOutLoading={signOutLoading}
      subscriptionDialog={
        <Dialog onOpenChange={setSubscriptionOpen} open={subscriptionOpen}>
          <DialogContent className="max-w-3xl">
            <SubscriptionSection
              loadingPlanId={loadingPlanId}
              monthlyPlanId={monthlyPlanId}
              onCheckout={handleCheckout}
              yearlyPlanId={yearlyPlanId}
            />
          </DialogContent>
        </Dialog>
      }
    />
  );
}
