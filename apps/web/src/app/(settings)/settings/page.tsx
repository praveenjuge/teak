"use client";

import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { Badge } from "@teak/ui/components/ui/badge";
import { Button } from "@teak/ui/components/ui/button";
import { Dialog, DialogContent } from "@teak/ui/components/ui/dialog";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { TOAST_IDS } from "@teak/ui/constants/toast";
import { cn } from "@teak/ui/lib/utils";
import {
  ApiKeysSection,
  CustomerPortalButton,
  DeleteAccountDialog,
  SettingRow,
  SettingsFooter,
  SubscriptionSection,
  ThemeToggle,
} from "@teak/ui/settings";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { openCustomerPortal } from "@/lib/customerPortal";
import { metrics } from "@/lib/metrics";

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

  // API Keys
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
    const planType = planId.includes("monthly") ? "monthly" : "yearly";
    metrics.checkoutInitiated(planType);
    const toastId = toast.loading("Opening checkout...", {
      id: TOAST_IDS.checkoutOpen,
    });
    try {
      const checkoutUrl = await createCheckoutLink({ productId: planId });

      // Determine the effective theme for Polar checkout
      // Polar only supports "light" or "dark", so we need to resolve "system"
      let effectiveTheme: "light" | "dark" = "light";
      if (theme === "dark") {
        effectiveTheme = "dark";
      } else if (theme === "system") {
        // Detect system preference
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
          metrics.checkoutCompleted(planType, true);
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
      metrics.checkoutCompleted(planType, false);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCheckoutLink" },
      });
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
          metrics.accountDeleted();
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
    metrics.logout();
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
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
    return (await createKey({ name: "API Keys" })) as { key: string };
  };

  const handleCreateCustomerPortal = async () => {
    metrics.customerPortalOpened();
    const toastId = toast.loading("Opening customer portal...", {
      id: TOAST_IDS.customerPortal,
    });
    try {
      await openCustomerPortal({
        createCustomerPortal: () => createCustomerPortal({}),
        openWindow: (url, target, features) =>
          window.open(url, target, features),
      });
      toast.success("Customer portal opened", { id: toastId });
    } catch (error) {
      console.error("Failed to open customer portal", error);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCustomerPortal" },
      });
      toast.error("Could not open portal", { id: toastId });
    }
  };

  return (
    <>
      <h1 className="font-semibold text-xl tracking-tight">Settings</h1>

      <SettingRow title="Email">
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : (user?.email ?? "Not available")}
        </Button>
      </SettingRow>

      <SettingRow title="Usage">
        <Button disabled size="sm" variant="ghost">
          {isLoading ? <Spinner /> : `${cardCount} Cards`}
        </Button>
      </SettingRow>

      <SettingRow title="Plan">
        {isLoading ? (
          <Button disabled size="sm" variant="ghost">
            <Spinner />
          </Button>
        ) : hasPremium ? (
          <>
            <Badge>Pro</Badge>
            <CustomerPortalButton
              className={cn(
                "inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
              )}
              onCreatePortal={handleCreateCustomerPortal}
            >
              Manage
              <ExternalLink className="size-4" />
            </CustomerPortalButton>
          </>
        ) : (
          <>
            <Badge variant="outline">Free Plan</Badge>
            <Button
              onClick={() => {
                metrics.modalOpened("upgrade");
                setSubscriptionOpen(true);
              }}
              size="sm"
              variant="link"
            >
              Upgrade
            </Button>
          </>
        )}
      </SettingRow>

      <ApiKeysSection
        isLoading={keys === undefined}
        keys={keys}
        onCreateKey={handleCreateApiKey}
      />

      <SettingRow title="Theme">
        <ThemeToggle onThemeChange={(value) => metrics.themeChanged(value)} />
      </SettingRow>

      <SettingRow title="Sign out">
        <Button
          disabled={signOutLoading}
          onClick={handleSignOut}
          size="sm"
          variant="link"
        >
          {signOutLoading ? <Spinner /> : "Sign out"}
        </Button>
      </SettingRow>

      <SettingsFooter onDeleteClick={() => setDeleteDialogOpen(true)} />

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

      <DeleteAccountDialog
        error={deleteError}
        loading={deleteLoading}
        onDelete={handleDeleteAccount}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
      />
    </>
  );
}
