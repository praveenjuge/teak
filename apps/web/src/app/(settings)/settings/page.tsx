"use client";

import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import * as Sentry from "@sentry/nextjs";
import { api } from "@teak/convex";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  type LucideIcon,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import Logo from "@/components/Logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { metrics } from "@/lib/metrics";
import { cn } from "@/lib/utils";

const featureList = [
  "Unlimited Cards",
  "Unlimited Storage",
  "Automatic Summary and Tags",
  "Automatic Audio Transcription",
  "Chrome Extension",
  "iOS Mobile App",
  "Android Mobile App",
];

const themeOptions = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
] as const;

type ThemeValue = (typeof themeOptions)[number]["value"];

interface DeleteState {
  open: boolean;
  confirmation: string;
  error: string | null;
  loading: boolean;
  [key: string]: unknown;
}

function useObjectState<T extends Record<string, unknown>>(
  createInitialState: () => T
) {
  const [state, setState] = useState<T>(createInitialState);
  const patch = (patchValue: Partial<T>) =>
    setState((prev) => ({ ...prev, ...patchValue }));
  const reset = () => setState(createInitialState());
  const setField = <K extends keyof T>(key: K, value: T[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  return { state, patch, reset, setField } as const;
}

function ErrorAlert({
  message,
  title = "Error",
  icon: Icon = AlertCircle,
}: {
  message?: string | null;
  title?: string;
  icon?: LucideIcon;
}) {
  if (!message) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function SettingRow({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle>{title}</CardTitle>
      <div className="-mx-2.5 flex items-center justify-end gap-2 -space-x-2.5">
        {children}
      </div>
    </div>
  );
}

interface CustomerPortalButtonProps {
  className?: string;
  children: ReactNode;
}

function CustomerPortalButton({
  className,
  children,
}: CustomerPortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);

  const handlePortal = async () => {
    setIsLoading(true);
    metrics.customerPortalOpened();
    try {
      const portalUrl = await createCustomerPortal({});
      window.open(portalUrl, "_blank");
    } catch (error) {
      console.error("Failed to open customer portal", error);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCustomerPortal" },
      });
      toast.error("Failed to open customer portal. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      className={className}
      disabled={isLoading}
      onClick={handlePortal}
      type="button"
    >
      {isLoading ? <Spinner /> : children}
    </button>
  );
}

interface PlanOptionProps {
  planId: string;
  title: string;
  priceAmount: number;
  intervalLabel: string;
  badge?: string;
  isLoading: boolean;
  onCheckout: (planId: string) => void;
}

function PlanOption({
  planId,
  title,
  priceAmount,
  intervalLabel,
  badge,
  isLoading,
  onCheckout,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `${(priceAmount / 100).toLocaleString()}$`
    : "--";

  return (
    <div className="relative flex w-full flex-col justify-between gap-4 overflow-hidden rounded-md border bg-background p-5 text-left">
      {badge && (
        <Badge className="absolute top-0 right-0 rounded-none rounded-bl-md px-3">
          {badge}
        </Badge>
      )}
      <p className="font-medium text-muted-foreground">{title}</p>
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-2">
          <p className="font-semibold text-4xl text-foreground">
            {formattedPrice}
          </p>
          <p className="pb-1 text-muted-foreground">{intervalLabel}</p>
        </div>

        <button
          className={cn(
            buttonVariants({
              variant: "outline",
            })
          )}
          disabled={isLoading}
          onClick={() => onCheckout(planId)}
          type="button"
        >
          {isLoading ? (
            <Spinner />
          ) : (
            <span className="flex items-center gap-2">
              Continue <ArrowRight className="size-4" />
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

interface SubscriptionSectionProps {
  onCheckout: (planId: string) => void;
  loadingPlanId: string | null;
}

function SubscriptionSection({
  onCheckout,
  loadingPlanId,
}: SubscriptionSectionProps) {
  const isProduction = process.env.NODE_ENV === "production";
  const monthlyPlanId = isProduction
    ? "d46c71a7-61dc-4dc8-b53d-9a73d0204c28"
    : "a02153cd-c49d-49ae-8be6-464296a39a23";
  const yearlyPlanId = isProduction
    ? "6fb24b68-09e0-42c4-b090-f0e03cb7de56"
    : "f3073c34-8b4d-40b7-8123-2f8cbacbc609";

  const plans = [
    {
      planId: monthlyPlanId,
      title: "Monthly",
      priceAmount: 1900,
      intervalLabel: "Per Month",
    },
    {
      planId: yearlyPlanId,
      title: "Yearly",
      priceAmount: 9900,
      intervalLabel: "Per Year",
      badge: "Best Value • 20% off",
    },
  ];

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>Upgrade to Pro</DialogTitle>
        <DialogDescription>
          Unlock all features and remove limits.
        </DialogDescription>
      </DialogHeader>

      {plans.map((plan) => (
        <PlanOption
          key={plan.planId}
          {...plan}
          isLoading={loadingPlanId === plan.planId}
          onCheckout={onCheckout}
        />
      ))}

      <div className="space-y-3 text-left">
        <p className="font-medium text-muted-foreground text-sm">
          Pro Features included:
        </p>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {featureList.map((feature) => (
            <li className="flex items-center gap-1.5 text-sm" key={feature}>
              <CheckCircle2 className="size-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

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
  const [mounted, setMounted] = useState(false);
  const {
    state: deleteState,
    patch: patchDeleteState,
    reset: resetDeleteState,
    setField: setDeleteField,
  } = useObjectState<DeleteState>(() => ({
    open: false,
    confirmation: "",
    error: null,
    loading: false,
  }));
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      checkoutInstance?.close();
    };
  }, [checkoutInstance]);

  const handleCheckout = async (planId: string) => {
    setLoadingPlanId(planId);
    const planType = planId.includes("monthly") ? "monthly" : "yearly";
    metrics.checkoutInitiated(planType);
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

      const checkout = await PolarEmbedCheckout.create(
        checkoutUrl,
        effectiveTheme
      );

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
      });
    } catch (error) {
      console.error("Failed to open checkout", error);
      metrics.checkoutCompleted(planType, false);
      Sentry.captureException(error, {
        tags: { source: "convex", action: "billing:createCheckoutLink" },
      });
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoadingPlanId(null);
    }
  };

  const isLoading = user === undefined;

  const confirmationMatches =
    deleteState.confirmation.trim().toLowerCase() === "delete account";

  const handleDeleteAccount = async () => {
    if (!confirmationMatches) {
      toast.error('Type "delete account" to confirm.');
      return;
    }

    patchDeleteState({ loading: true, error: null });

    try {
      await deleteAccount({});

      let deleteUserFailed = false;
      await authClient.deleteUser(undefined, {
        onSuccess: async () => {
          metrics.accountDeleted();
          router.push("/login");
        },
        onError: (ctx) => {
          patchDeleteState({
            error: ctx.error?.message ?? "Failed to delete account.",
          });
          deleteUserFailed = true;
        },
      });

      if (deleteUserFailed) {
        return;
      }

      resetDeleteState();
    } catch {
      patchDeleteState({
        error: "Something went wrong while deleting your account.",
      });
    } finally {
      patchDeleteState({ loading: false });
    }
  };

  const handleDeleteDialogChange = (open: boolean) => {
    if (open) {
      metrics.modalOpened("delete_account");
      patchDeleteState({ open: true });
    } else {
      resetDeleteState();
    }
  };

  const handleDeleteConfirmationChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => setDeleteField("confirmation", event.target.value);

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

  const handleThemeChange = (value: ThemeValue) => () => {
    metrics.themeChanged(value);
    setTheme(value);
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
              className={cn(buttonVariants({ variant: "link", size: "sm" }))}
            >
              Manage
              <ExternalLink />
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

      <SettingRow title="Theme">
        <div className="flex items-center gap-px">
          {themeOptions.map(({ value, icon: Icon }) => (
            <Button
              key={value}
              onClick={handleThemeChange(value)}
              size="sm"
              variant={mounted && theme === value ? "secondary" : "ghost"}
            >
              <Icon />
            </Button>
          ))}
        </div>
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

      <div className="relative mt-12 flex flex-col items-start gap-5">
        <Logo variant="primary" />
        <div className="text-muted-foreground">
          Let me know{" "}
          <a
            className="font-medium text-primary"
            href="https://x.com/praveenjuge"
            rel="noopener"
            target="_blank"
          >
            @praveenjuge
          </a>{" "}
          /{" "}
          <a
            className="select-all font-medium text-primary"
            href="mailto:hello@praveenjuge.com"
          >
            hello@praveenjuge.com
          </a>{" "}
          if you have any feedback. You can delete you account{" "}
          <Button
            className="h-auto p-0"
            onClick={() => patchDeleteState({ open: true })}
            size="sm"
            variant="link"
          >
            here
          </Button>
          . Hope you enjoy using Teak as much as I enjoyed creating it.
        </div>
        <svg
          className="w-28 text-muted-foreground"
          fill="currentColor"
          viewBox="0 0 138 48"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M23.608 1.61789C24.076 1.92989 24.4747 2.32856 24.804 2.81389C25.1507 3.28189 25.428 3.88856 25.636 4.63389C25.8613 5.36189 25.9133 6.28056 25.792 7.38989C25.6707 8.49922 25.3673 9.73856 24.882 11.1079C23.2873 15.5279 21.1727 18.9946 18.538 21.5079C17.4807 22.5132 16.3887 23.2932 15.262 23.8479C14.1527 24.4026 13.0953 24.6799 12.09 24.6799C11.986 24.6799 11.882 24.6712 11.778 24.6539C10.2007 24.5499 9.08267 23.8046 8.424 22.4179C6.24 31.4832 4.98333 37.2466 4.654 39.7079C4.68867 39.6386 4.72333 39.5606 4.758 39.4739C4.81 39.3526 4.89667 39.2659 5.018 39.2139C5.15667 39.1619 5.28667 39.1619 5.408 39.2139C5.52933 39.2832 5.616 39.3786 5.668 39.4999C5.72 39.6386 5.72 39.7686 5.668 39.8899C5.33867 40.6006 5.07 41.1032 4.862 41.3979C4.654 41.7099 4.43733 41.8659 4.212 41.8659C4.14267 41.8659 4.07333 41.8486 4.004 41.8139C3.744 41.7272 3.59667 41.4759 3.562 41.0599C3.52733 40.6612 3.62267 39.8032 3.848 38.4859C4.108 36.9086 4.56733 34.6466 5.226 31.6999C6.04067 28.0599 7.514 21.8892 9.646 13.1879C10.8593 8.21323 11.674 4.85056 12.09 3.09989C9.71533 4.10522 7.67867 5.35322 5.98 6.84389C5.11333 7.60656 4.40267 8.36922 3.848 9.13189C3.29333 9.89456 2.90333 10.5792 2.678 11.1859C2.47 11.7752 2.34867 12.3646 2.314 12.9539C2.29667 13.5432 2.33133 14.0372 2.418 14.4359C2.522 14.8172 2.66067 15.1899 2.834 15.5539C2.90333 15.6752 2.912 15.8052 2.86 15.9439C2.82533 16.0652 2.74733 16.1606 2.626 16.2299C2.50467 16.2819 2.37467 16.2906 2.236 16.2559C2.11467 16.2039 2.01933 16.1172 1.95 15.9959C1.18733 14.4706 1.092 12.8412 1.664 11.1079C2.25333 9.37456 3.46667 7.70189 5.304 6.08989C7.29733 4.35656 9.65467 2.96123 12.376 1.90389C12.4453 1.55722 12.5147 1.24522 12.584 0.967892C12.6013 0.846558 12.6707 0.751225 12.792 0.681892C12.9133 0.595226 13.0347 0.569225 13.156 0.603892C13.2947 0.621226 13.3987 0.690559 13.468 0.811892C13.5547 0.933225 13.5807 1.06322 13.546 1.20189C13.5287 1.25389 13.5113 1.34922 13.494 1.48789C13.9273 1.34922 14.3607 1.21922 14.794 1.09789C16.6487 0.595225 18.33 0.387225 19.838 0.473892C21.3633 0.560558 22.62 0.941891 23.608 1.61789ZM23.92 10.7699C24.1453 10.1459 24.3273 9.54789 24.466 8.97589C24.622 8.40389 24.726 7.78856 24.778 7.12989C24.8473 6.45389 24.8387 5.84723 24.752 5.30989C24.6827 4.75522 24.5007 4.22656 24.206 3.72389C23.9287 3.20389 23.5387 2.77056 23.036 2.42389C22.1867 1.85189 21.06 1.53989 19.656 1.48789C18.2693 1.41856 16.7353 1.60922 15.054 2.05989C14.4473 2.23322 13.832 2.43256 13.208 2.65789C12.8093 4.44322 11.9513 8.03122 10.634 13.4219C9.854 16.5592 9.24733 19.0206 8.814 20.8059C8.93533 20.8752 9.01333 20.9792 9.048 21.1179C9.22133 21.8979 9.542 22.5046 10.01 22.9379C10.4953 23.3712 11.102 23.6139 11.83 23.6659C12.714 23.7179 13.6847 23.4926 14.742 22.9899C15.7993 22.4872 16.8393 21.7506 17.862 20.7799C20.3753 18.3879 22.3947 15.0512 23.92 10.7699ZM33.9777 20.9879C34.1164 20.9359 34.2464 20.9446 34.3677 21.0139C34.4891 21.0659 34.5757 21.1612 34.6277 21.2999C34.6797 21.4212 34.6711 21.5426 34.6017 21.6639C34.1337 22.6692 33.6051 23.7006 33.0157 24.7579C32.4264 25.8152 31.7764 26.8812 31.0657 27.9559C30.3724 29.0479 29.6791 29.9319 28.9857 30.6079C28.2924 31.3012 27.7031 31.6479 27.2177 31.6479C27.0964 31.6479 26.9837 31.6219 26.8797 31.5699C26.1691 31.2926 25.9437 30.2179 26.2037 28.3459C26.4464 26.5952 27.0877 24.1166 28.1277 20.9099C28.1104 20.9099 28.0931 20.9186 28.0757 20.9359C28.0757 20.9359 28.0671 20.9359 28.0497 20.9359C27.6684 21.1959 27.3477 21.3952 27.0877 21.5339C26.8451 21.6726 26.5071 21.8286 26.0737 22.0019C25.6577 22.1752 25.2591 22.2532 24.8777 22.2359C24.4964 22.2186 24.1411 22.0972 23.8117 21.8719C23.1531 21.4039 22.8151 20.7539 22.7977 19.9219C22.7804 19.0899 23.0924 18.1799 23.7337 17.1919C24.1324 16.5679 24.6091 16.0219 25.1637 15.5539C25.7357 15.0859 26.2211 14.9819 26.6197 15.2419C26.8624 15.3806 27.0011 15.6059 27.0357 15.9179C27.0877 16.2299 26.9404 16.8366 26.5937 17.7379C26.2471 18.6219 25.6664 19.7832 24.8517 21.2219C25.3891 21.2912 26.2731 20.9186 27.5037 20.1039C27.7291 19.9479 27.8937 19.8439 27.9977 19.7919C28.1191 19.7226 28.2491 19.6532 28.3877 19.5839C28.5437 19.5146 28.6737 19.4886 28.7777 19.5059C28.8817 19.5232 28.9857 19.5666 29.0897 19.6359C29.3497 19.8439 29.3931 20.2079 29.2197 20.7279C27.4864 26.1012 26.8017 29.3599 27.1657 30.5039C27.2004 30.5732 27.2264 30.6252 27.2437 30.6599C27.3824 30.6772 27.5904 30.5646 27.8677 30.3219C28.1624 30.0792 28.5177 29.6979 28.9337 29.1779C29.3671 28.6579 29.8264 28.0339 30.3117 27.3059C30.8144 26.5779 31.3604 25.6852 31.9497 24.6279C32.5564 23.5706 33.1371 22.4439 33.6917 21.2479C33.7611 21.1092 33.8564 21.0226 33.9777 20.9879ZM23.8897 19.2199C23.7337 19.8266 23.7684 20.3119 23.9937 20.6759C25.2591 18.4746 25.9351 16.9839 26.0217 16.2039C25.8137 16.3252 25.5711 16.5246 25.2937 16.8019C25.0337 17.0792 24.7564 17.4432 24.4617 17.8939C24.1844 18.3272 23.9937 18.7692 23.8897 19.2199ZM43.8425 21.0919C43.9812 21.0399 44.1112 21.0486 44.2325 21.1179C44.3538 21.1699 44.4318 21.2652 44.4665 21.4039C44.5185 21.5252 44.5185 21.6466 44.4665 21.7679C42.6118 25.5986 40.9565 27.5139 39.5005 27.5139C39.4138 27.5139 39.3185 27.5052 39.2145 27.4879C38.0532 27.2626 37.3338 25.7026 37.0565 22.8079C36.2072 23.9519 35.4532 24.8879 34.7945 25.6159C34.2052 26.2399 33.7025 26.4566 33.2865 26.2659C32.8705 26.1099 32.6712 25.6592 32.6885 24.9139C32.6885 24.2899 32.8272 23.5446 33.1045 22.6779C33.3818 21.8112 33.7892 20.9706 34.3265 20.1559C34.8638 19.3412 35.4445 18.8299 36.0685 18.6219C36.9872 18.2926 37.8365 18.5959 38.6165 19.5319C38.7032 19.6359 38.7378 19.7572 38.7205 19.8959C38.7205 20.0346 38.6685 20.1472 38.5645 20.2339C38.4605 20.3206 38.3392 20.3639 38.2005 20.3639C38.0618 20.3466 37.9492 20.2859 37.8625 20.1819C37.2558 19.4539 36.6405 19.3152 36.0165 19.7659C35.3058 20.2686 34.7078 21.1786 34.2225 22.4959C33.7545 23.7959 33.5725 24.7232 33.6765 25.2779C33.7805 25.1912 33.9018 25.0786 34.0405 24.9399C34.7338 24.1946 35.5832 23.1286 36.5885 21.7419C36.8138 21.4299 36.9698 21.2132 37.0565 21.0919C37.1952 20.9186 37.3772 20.8666 37.6025 20.9359C37.8278 20.9879 37.9492 21.1352 37.9665 21.3779C38.0012 22.2272 38.0705 22.9812 38.1745 23.6399C38.2785 24.2986 38.3825 24.8012 38.4865 25.1479C38.5905 25.4772 38.7118 25.7546 38.8505 25.9799C38.9892 26.2052 39.0932 26.3526 39.1625 26.4219C39.2492 26.4739 39.3358 26.4999 39.4225 26.4999C39.6652 26.5519 39.9685 26.4392 40.3325 26.1619C40.7138 25.8672 41.1905 25.3126 41.7625 24.4979C42.3518 23.6659 42.9498 22.6172 43.5565 21.3519C43.6258 21.2132 43.7212 21.1266 43.8425 21.0919ZM55.7003 21.1179C55.839 21.1006 55.9603 21.1352 56.0643 21.2219C56.1857 21.3086 56.2463 21.4212 56.2463 21.5599C56.2637 21.6986 56.229 21.8199 56.1423 21.9239C55.4837 22.6866 54.7297 23.2412 53.8803 23.5879C53.031 23.9172 52.225 23.9779 51.4623 23.7699C50.5783 23.5446 49.8937 22.9986 49.4083 22.1319C48.975 23.6399 48.3163 25.1219 47.4323 26.5779C46.843 27.5659 46.245 28.3806 45.6383 29.0219C45.0317 29.6806 44.4857 30.0879 44.0003 30.2439C43.827 30.2959 43.6623 30.3219 43.5063 30.3219C43.1943 30.3219 42.9343 30.2179 42.7263 30.0099C41.721 28.9872 42.2237 25.4686 44.2343 19.4539C44.269 19.3326 44.347 19.2459 44.4683 19.1939C44.607 19.1246 44.737 19.1159 44.8583 19.1679C44.997 19.2026 45.0923 19.2806 45.1443 19.4019C45.2137 19.5232 45.2223 19.6532 45.1703 19.7919C44.6677 21.3172 44.2603 22.6866 43.9483 23.8999C43.6363 25.0959 43.4283 26.0146 43.3243 26.6559C43.2377 27.2799 43.203 27.8086 43.2203 28.2419C43.2377 28.6752 43.2637 28.9439 43.2983 29.0479C43.333 29.1692 43.3763 29.2472 43.4283 29.2819C43.4803 29.3339 43.567 29.3339 43.6883 29.2819C44.1737 29.1259 44.7803 28.5799 45.5083 27.6439C46.2363 26.7079 46.921 25.5552 47.5623 24.1859C48.2037 22.7992 48.611 21.4906 48.7843 20.2599C48.8017 20.1386 48.8537 20.0432 48.9403 19.9739C49.0443 19.8872 49.157 19.8352 49.2783 19.8179C49.5557 19.8179 49.7203 19.9566 49.7723 20.2339C50.0497 21.6899 50.6997 22.5479 51.7223 22.8079C52.2943 22.9639 52.9097 22.9032 53.5683 22.6259C54.2443 22.3486 54.8423 21.8979 55.3623 21.2739C55.4663 21.1699 55.579 21.1179 55.7003 21.1179ZM63.7 21.0139C63.8387 20.9792 63.96 21.0052 64.064 21.0919C64.1853 21.1612 64.2547 21.2652 64.272 21.4039C64.2893 21.5426 64.2633 21.6639 64.194 21.7679C62.2353 24.5066 60.45 26.4479 58.838 27.5919C58.1967 28.0426 57.564 28.2679 56.94 28.2679C56.4547 28.2679 56.03 28.1379 55.666 27.8779C55.458 27.7219 55.276 27.5139 55.12 27.2539C54.9467 26.9939 54.7993 26.6299 54.678 26.1619C54.5567 25.6939 54.5393 25.0786 54.626 24.3159C54.6953 23.5532 54.886 22.6866 55.198 21.7159V21.6899C55.6833 20.1126 56.2727 18.8646 56.966 17.9459C57.6593 17.0272 58.2833 16.5592 58.838 16.5419C59.2367 16.5246 59.4967 16.6979 59.618 17.0619C59.8087 17.5646 59.5833 18.2752 58.942 19.1939C58.3007 20.1126 57.356 21.1006 56.108 22.1579C55.9 22.8339 55.7527 23.4579 55.666 24.0299C55.5793 24.6019 55.5447 25.0612 55.562 25.4079C55.5967 25.7372 55.6573 26.0319 55.744 26.2919C55.848 26.5346 55.9347 26.7079 56.004 26.8119C56.0907 26.9159 56.1773 27.0026 56.264 27.0719C56.784 27.4532 57.4513 27.3492 58.266 26.7599C59.7913 25.6852 61.49 23.8306 63.362 21.1959C63.4487 21.0919 63.5613 21.0312 63.7 21.0139ZM58.656 17.6339C58.0493 18.0152 57.4513 18.8386 56.862 20.1039C57.8673 19.0986 58.4653 18.2752 58.656 17.6339ZM71.2664 21.0139C71.4051 20.9792 71.5264 21.0052 71.6304 21.0919C71.7517 21.1612 71.8211 21.2652 71.8384 21.4039C71.8557 21.5426 71.8297 21.6639 71.7604 21.7679C69.8017 24.5066 68.0164 26.4479 66.4044 27.5919C65.7631 28.0426 65.1304 28.2679 64.5064 28.2679C64.0211 28.2679 63.5964 28.1379 63.2324 27.8779C63.0244 27.7219 62.8424 27.5139 62.6864 27.2539C62.5131 26.9939 62.3657 26.6299 62.2444 26.1619C62.1231 25.6939 62.1057 25.0786 62.1924 24.3159C62.2617 23.5532 62.4524 22.6866 62.7644 21.7159V21.6899C63.2497 20.1126 63.8391 18.8646 64.5324 17.9459C65.2257 17.0272 65.8497 16.5592 66.4044 16.5419C66.8031 16.5246 67.0631 16.6979 67.1844 17.0619C67.3751 17.5646 67.1497 18.2752 66.5084 19.1939C65.8671 20.1126 64.9224 21.1006 63.6744 22.1579C63.4664 22.8339 63.3191 23.4579 63.2324 24.0299C63.1457 24.6019 63.1111 25.0612 63.1284 25.4079C63.1631 25.7372 63.2237 26.0319 63.3104 26.2919C63.4144 26.5346 63.5011 26.7079 63.5704 26.8119C63.6571 26.9159 63.7437 27.0026 63.8304 27.0719C64.3504 27.4532 65.0177 27.3492 65.8324 26.7599C67.3577 25.6852 69.0564 23.8306 70.9284 21.1959C71.0151 21.0919 71.1277 21.0312 71.2664 21.0139ZM66.2224 17.6339C65.6157 18.0152 65.0177 18.8386 64.4284 20.1039C65.4337 19.0986 66.0317 18.2752 66.2224 17.6339ZM80.4968 21.0399C80.6355 21.0052 80.7655 21.0226 80.8868 21.0919C81.0081 21.1612 81.0861 21.2652 81.1208 21.4039C81.1555 21.5252 81.1381 21.6466 81.0688 21.7679C80.4795 22.8079 79.9681 23.6312 79.5348 24.2379C79.1015 24.8446 78.6595 25.3212 78.2088 25.6679C77.7581 26.0146 77.3161 26.1619 76.8828 26.1099C76.0161 26.0059 75.3315 25.0699 74.8288 23.3019C74.4648 22.1059 74.1528 21.5079 73.8928 21.5079C73.8408 21.4906 73.7628 21.5166 73.6588 21.5859C73.5721 21.6379 73.4248 21.7939 73.2168 22.0539C73.0088 22.2966 72.7748 22.6346 72.5148 23.0679C72.2721 23.5012 71.9428 24.1426 71.5268 24.9919C71.1281 25.8412 70.6948 26.8466 70.2268 28.0079C70.1401 28.2159 69.9841 28.3199 69.7588 28.3199C69.7241 28.3199 69.6895 28.3112 69.6548 28.2939C69.3601 28.2246 69.2301 28.0426 69.2648 27.7479C69.4381 26.3266 70.0881 23.6832 71.2148 19.8179C71.3361 19.4192 71.4228 19.1159 71.4748 18.9079C71.5268 18.7692 71.6135 18.6739 71.7348 18.6219C71.8561 18.5526 71.9775 18.5352 72.0988 18.5699C72.2375 18.6046 72.3415 18.6826 72.4108 18.8039C72.4801 18.9252 72.4888 19.0552 72.4368 19.1939C72.4021 19.3152 72.3155 19.6186 72.1768 20.1039C71.7955 21.4386 71.5008 22.4786 71.2928 23.2239C71.8475 22.1839 72.3328 21.4646 72.7488 21.0659C73.1648 20.6672 73.5635 20.4766 73.9448 20.4939C74.3955 20.5112 74.7508 20.7452 75.0108 21.1959C75.2881 21.6466 75.5481 22.2619 75.7908 23.0419C76.1721 24.3766 76.5795 25.0699 77.0128 25.1219C77.2208 25.1566 77.4721 25.0439 77.7668 24.7839C78.0788 24.5066 78.4081 24.1166 78.7548 23.6139C79.1015 23.0939 79.3615 22.6866 79.5348 22.3919C79.7255 22.0972 79.9421 21.7246 80.1848 21.2739C80.2541 21.1526 80.3581 21.0746 80.4968 21.0399ZM109.774 14.8779C109.774 14.9646 109.757 15.0512 109.722 15.1379C109.688 15.2072 109.636 15.2679 109.566 15.3199C109.497 15.3719 109.419 15.4066 109.332 15.4239C107.304 15.6492 105.415 16.0306 103.664 16.5679C101.723 25.1132 100.206 32.0206 99.1144 37.2899C98.7504 38.9366 98.2304 40.2539 97.5544 41.2419C96.8784 42.2472 96.0811 42.8626 95.1624 43.0879C94.9198 43.1572 94.6684 43.1919 94.4084 43.1919C93.1951 43.1919 92.0771 42.5766 91.0544 41.3459C90.3091 40.4446 89.7458 39.2312 89.3644 37.7059C88.9831 36.1979 88.8618 34.4646 89.0004 32.5059C89.1391 30.5646 89.5724 28.6839 90.3004 26.8639C91.6004 23.6746 93.6718 21.0399 96.5144 18.9599C98.3344 17.6426 100.44 16.5852 102.832 15.7879C103.56 12.5639 104.184 9.88589 104.704 7.75389C104.982 6.62722 105.146 5.67389 105.198 4.89389C105.25 4.11389 105.233 3.60256 105.146 3.35989C105.077 3.09989 104.99 2.95256 104.886 2.91789C104.678 2.84856 104.384 2.96989 104.002 3.28189C103.621 3.57656 103.214 4.03589 102.78 4.65989C102.347 5.26656 102 5.92522 101.74 6.63589C101.619 6.96522 101.524 7.29456 101.454 7.62389C101.385 7.93589 101.35 8.28256 101.35 8.66389C101.35 9.04523 101.446 9.40056 101.636 9.72989C101.844 10.0419 102.139 10.2846 102.52 10.4579C102.642 10.5099 102.728 10.6052 102.78 10.7439C102.832 10.8652 102.832 10.9866 102.78 11.1079C102.728 11.2292 102.633 11.3159 102.494 11.3679C102.373 11.4199 102.243 11.4199 102.104 11.3679C101.255 10.9866 100.709 10.3452 100.466 9.44389C100.241 8.54256 100.354 7.48522 100.804 6.27189C101.238 5.09322 101.896 4.02722 102.78 3.07389C103.664 2.10322 104.462 1.73056 105.172 1.95589C106.386 2.31989 106.55 4.33056 105.666 7.98789C105.181 9.99856 104.6 12.4859 103.924 15.4499C105.571 14.9819 107.339 14.6439 109.228 14.4359C109.35 14.4186 109.462 14.4532 109.566 14.5399C109.688 14.6266 109.757 14.7392 109.774 14.8779ZM98.1264 37.0819C99.1838 32.0379 100.666 25.3212 102.572 16.9319C100.96 17.5039 99.4958 18.1972 98.1784 19.0119C96.8784 19.8266 95.7864 20.7106 94.9024 21.6639C94.0184 22.5999 93.2818 23.5186 92.6924 24.4199C92.1204 25.3212 91.6351 26.2659 91.2364 27.2539C90.6644 28.6579 90.2744 30.1919 90.0664 31.8559C89.8758 33.5372 89.9191 35.1926 90.1964 36.8219C90.4911 38.4512 91.0284 39.7426 91.8084 40.6959C92.2938 41.2852 92.8051 41.7012 93.3424 41.9439C93.8971 42.1866 94.4258 42.2472 94.9284 42.1259C95.6564 41.9526 96.2891 41.4326 96.8264 40.5659C97.3811 39.6992 97.8144 38.5379 98.1264 37.0819ZM117.946 21.2219C118.084 21.1872 118.206 21.2046 118.31 21.2739C118.431 21.3432 118.509 21.4472 118.544 21.5859C118.578 21.7246 118.561 21.8459 118.492 21.9499C118.284 22.2792 118.058 22.6346 117.816 23.0159C117.573 23.3799 117.209 23.8826 116.724 24.5239C116.256 25.1652 115.805 25.7286 115.372 26.2139C114.938 26.6819 114.47 27.0979 113.968 27.4619C113.465 27.8259 113.032 28.0079 112.668 28.0079C112.529 28.0079 112.408 27.9819 112.304 27.9299C111.472 27.6179 111.238 26.2919 111.602 23.9519C111.03 24.7319 110.51 25.3212 110.042 25.7199C109.366 26.2919 108.776 26.3612 108.274 25.9279C107.806 25.5466 107.598 24.8706 107.65 23.8999C107.684 22.9292 107.962 21.9932 108.482 21.0919C108.551 20.9706 108.655 20.8926 108.794 20.8579C108.932 20.8232 109.062 20.8406 109.184 20.9099C109.305 20.9792 109.383 21.0832 109.418 21.2219C109.452 21.3432 109.435 21.4646 109.366 21.5859C109.071 22.0712 108.863 22.5826 108.742 23.1199C108.638 23.6572 108.603 24.1079 108.638 24.4719C108.69 24.8186 108.776 25.0439 108.898 25.1479C108.984 25.2346 109.149 25.1739 109.392 24.9659C109.842 24.5846 110.406 23.8999 111.082 22.9119C111.203 22.7559 111.29 22.6432 111.342 22.5739C111.411 22.4872 111.489 22.3919 111.576 22.2879C111.662 22.1666 111.732 22.0886 111.784 22.0539C111.836 22.0192 111.896 21.9846 111.966 21.9499C112.035 21.8979 112.104 21.8806 112.174 21.8979C112.243 21.8979 112.321 21.9152 112.408 21.9499C112.633 22.0366 112.754 22.2359 112.772 22.5479C112.789 22.8426 112.746 23.2326 112.642 23.7179C112.451 24.6712 112.373 25.3992 112.408 25.9019C112.46 26.4046 112.503 26.7166 112.538 26.8379C112.572 26.9419 112.616 26.9939 112.668 26.9939C112.72 27.0286 112.806 27.0112 112.928 26.9419C113.066 26.8899 113.222 26.7946 113.396 26.6559C113.586 26.5172 113.794 26.3439 114.02 26.1359C114.245 25.9106 114.496 25.6419 114.774 25.3299C115.068 25.0179 115.363 24.6799 115.658 24.3159C115.952 23.9346 116.273 23.5012 116.62 23.0159C116.966 22.5132 117.304 21.9846 117.634 21.4299C117.703 21.3086 117.807 21.2392 117.946 21.2219ZM128.876 20.9099C129.015 20.9446 129.119 21.0226 129.188 21.1439C129.275 21.2479 129.301 21.3692 129.266 21.5079C129.249 21.6466 129.179 21.7506 129.058 21.8199C125.938 23.8479 123.485 25.6246 121.7 27.1499C120.608 33.7366 119.334 38.7459 117.878 42.1779C116.422 45.6099 115.001 47.5166 113.614 47.8979C113.423 47.9499 113.241 47.9759 113.068 47.9759C112.513 47.9759 112.037 47.7332 111.638 47.2479C110.893 46.3119 110.624 44.8126 110.832 42.7499C111.075 40.5312 111.829 38.2606 113.094 35.9379C114.949 32.5926 117.505 29.4899 120.764 26.6299C121.007 25.1566 121.232 23.6139 121.44 22.0019C120.885 22.8339 120.374 23.5619 119.906 24.1859C119.178 25.1392 118.554 25.5379 118.034 25.3819C117.618 25.2606 117.375 24.8792 117.306 24.2379C117.254 23.6312 117.341 22.8512 117.566 21.8979C117.809 20.9272 118.199 19.9739 118.736 19.0379C119.273 18.1019 119.863 17.4779 120.504 17.1659C121.388 16.7152 122.246 16.8626 123.078 17.6079C123.182 17.7119 123.234 17.8332 123.234 17.9719C123.251 18.0932 123.208 18.2059 123.104 18.3099C123.017 18.4139 122.905 18.4746 122.766 18.4919C122.627 18.4919 122.506 18.4486 122.402 18.3619C121.778 17.7899 121.145 17.7899 120.504 18.3619C119.776 19.0206 119.195 20.0692 118.762 21.5079C118.329 22.9292 118.19 23.8826 118.346 24.3679C118.537 24.2466 118.788 23.9866 119.1 23.5879C120.209 22.1319 121.102 20.8059 121.778 19.6099C121.917 19.3846 122.116 19.3152 122.376 19.4019C122.636 19.4712 122.749 19.6446 122.714 19.9219C122.471 21.9152 122.211 23.8219 121.934 25.6419C123.546 24.3246 125.739 22.7732 128.512 20.9879C128.633 20.9012 128.755 20.8752 128.876 20.9099ZM113.328 46.9359C113.796 46.8146 114.307 46.3986 114.862 45.6879C115.399 44.9772 115.989 43.9372 116.63 42.5679C117.271 41.1986 117.93 39.2746 118.606 36.7959C119.299 34.3172 119.932 31.4659 120.504 28.2419C117.765 30.7726 115.59 33.5026 113.978 36.4319C113.458 37.3679 113.033 38.3039 112.704 39.2399C112.357 40.1759 112.115 41.0252 111.976 41.7879C111.837 42.5506 111.768 43.2526 111.768 43.8939C111.768 44.5526 111.829 45.1072 111.95 45.5579C112.071 46.0086 112.227 46.3639 112.418 46.6239C112.678 46.9359 112.981 47.0399 113.328 46.9359ZM136.419 21.0139C136.557 20.9792 136.679 21.0052 136.783 21.0919C136.904 21.1612 136.973 21.2652 136.991 21.4039C137.008 21.5426 136.982 21.6639 136.913 21.7679C134.954 24.5066 133.169 26.4479 131.557 27.5919C130.915 28.0426 130.283 28.2679 129.659 28.2679C129.173 28.2679 128.749 28.1379 128.385 27.8779C128.177 27.7219 127.995 27.5139 127.839 27.2539C127.665 26.9939 127.518 26.6299 127.397 26.1619C127.275 25.6939 127.258 25.0786 127.345 24.3159C127.414 23.5532 127.605 22.6866 127.917 21.7159V21.6899C128.402 20.1126 128.991 18.8646 129.685 17.9459C130.378 17.0272 131.002 16.5592 131.557 16.5419C131.955 16.5246 132.215 16.6979 132.337 17.0619C132.527 17.5646 132.302 18.2752 131.661 19.1939C131.019 20.1126 130.075 21.1006 128.827 22.1579C128.619 22.8339 128.471 23.4579 128.385 24.0299C128.298 24.6019 128.263 25.0612 128.281 25.4079C128.315 25.7372 128.376 26.0319 128.463 26.2919C128.567 26.5346 128.653 26.7079 128.723 26.8119C128.809 26.9159 128.896 27.0026 128.983 27.0719C129.503 27.4532 130.17 27.3492 130.985 26.7599C132.51 25.6852 134.209 23.8306 136.081 21.1959C136.167 21.0919 136.28 21.0312 136.419 21.0139ZM131.375 17.6339C130.768 18.0152 130.17 18.8386 129.581 20.1039C130.586 19.0986 131.184 18.2752 131.375 17.6339Z" />
        </svg>
      </div>

      <Dialog onOpenChange={setSubscriptionOpen} open={subscriptionOpen}>
        <DialogContent className="max-w-3xl">
          <SubscriptionSection
            loadingPlanId={loadingPlanId}
            onCheckout={handleCheckout}
          />
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={handleDeleteDialogChange} open={deleteState.open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This action permanently removes your account, cards, and uploaded
              files.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Permanent and irreversible</AlertTitle>
              <AlertDescription>
                All of your cards, tags, and stored files will be deleted. This
                cannot be undone.
              </AlertDescription>
            </Alert>

            <ErrorAlert message={deleteState.error} />

            <div className="space-y-2">
              <Label htmlFor="deleteConfirm">
                Type &quot;delete account&quot; to proceed
              </Label>
              <Input
                id="deleteConfirm"
                onChange={handleDeleteConfirmationChange}
                placeholder="delete account"
                value={deleteState.confirmation}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              disabled={!confirmationMatches || deleteState.loading}
              onClick={handleDeleteAccount}
              variant="destructive"
            >
              {deleteState.loading ? <Spinner /> : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
