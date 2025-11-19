"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useAction } from "convex/react";
import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { api } from "@teak/convex";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const featureList = [
  "Unlimited Cards",
  "Unlimited Storage",
  "Automatic Summary and Tags",
  "Automatic Audio Transcription",
  "Chrome Extension",
  "iOS Mobile App",
  "Android Mobile App",
];

interface CheckoutButtonProps {
  planId: string;
  className?: string;
  children: React.ReactNode;
}

interface CustomerPortalButtonProps {
  className?: string;
  children: React.ReactNode;
}

function CheckoutButton({ planId, className, children }: CheckoutButtonProps) {
  const [checkoutInstance, setCheckoutInstance] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  // @ts-ignore
  const createCheckoutLink = useAction(api.billing.createCheckoutLink);

  // Clean up checkout instance on unmount
  useEffect(() => {
    return () => {
      if (checkoutInstance) {
        checkoutInstance.close();
      }
    };
  }, [checkoutInstance]);

  const handleCheckout = async () => {
    setIsLoading(true);
    try {
      const checkoutUrl = await createCheckoutLink({ productId: planId });
      const checkout = await PolarEmbedCheckout.create(checkoutUrl, "light");

      setCheckoutInstance(checkout);
      setIsLoading(false);

      checkout.addEventListener("success", (event: any) => {
        if (!event.detail.redirect) {
          // toast.success("Welcome to Pro! Your subscription has been activated.");
        }
      });

      checkout.addEventListener("close", (event: any) => {
        setCheckoutInstance(null);
      });
    } catch (error) {
      console.error("Failed to open checkout", error);
      toast.error("Failed to start checkout. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <button onClick={handleCheckout} className={className} disabled={isLoading}>
      {isLoading ? <Spinner /> : children}
    </button>
  );
}

function CustomerPortalButton({
  className,
  children,
}: CustomerPortalButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const createCustomerPortal = useAction(api.billing.createCustomerPortal);

  const handlePortal = async () => {
    setIsLoading(true);
    try {
      const portalUrl = await createCustomerPortal({});
      window.open(portalUrl, "_blank");
      setIsLoading(false);
    } catch (error) {
      console.error("Failed to open customer portal", error);
      toast.error("Failed to open customer portal. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <button onClick={handlePortal} className={className} disabled={isLoading}>
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
  buttonVariant: "outline" | "destructive";
}

function PlanOption({
  planId,
  title,
  priceAmount,
  intervalLabel,
  badge,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `${(priceAmount / 100).toLocaleString()}$`
    : "--";

  return (
    <div className="flex w-full flex-col justify-between rounded-md border bg-background p-5 text-left gap-4 relative overflow-hidden">
      {badge && (
        <Badge className="rounded-none absolute top-0 right-0 rounded-bl-md px-3">
          {badge}
        </Badge>
      )}
      <p className="font-medium text-muted-foreground">{title}</p>
      <div className="flex justify-between items-end">
        <div className="flex gap-2 items-end">
          <p className="text-4xl font-semibold text-foreground">
            {formattedPrice}
          </p>
          <p className="text-muted-foreground pb-1">{intervalLabel}</p>
        </div>

        <CheckoutButton
          planId={planId}
          className={cn(
            buttonVariants({
              variant: "outline",
            })
          )}
        >
          Continue
          <ArrowRight />
        </CheckoutButton>
      </div>
    </div>
  );
}

interface SubscriptionSectionProps {
  open: boolean;
}

export function SubscriptionSection({ open }: SubscriptionSectionProps) {
  const isProduction = process.env.NODE_ENV === "production";
  const monthlyPlanId = isProduction
    ? "d46c71a7-61dc-4dc8-b53d-9a73d0204c28"
    : "a02153cd-c49d-49ae-8be6-464296a39a23";
  const yearlyPlanId = isProduction
    ? "6fb24b68-09e0-42c4-b090-f0e03cb7de56"
    : "f3073c34-8b4d-40b7-8123-2f8cbacbc609";

  // @ts-ignore
  const subscription = useQuery(api.billing.userHasPremium, {});
  const isSubscribed = subscription === true;

  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "grid transition-all duration-300 ease-in-out overflow-hidden",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 mt-0"
      )}
    >
      <div className="min-h-0 space-y-6" ref={contentRef}>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {isSubscribed ? "Manage Subscription" : "Upgrade to Pro"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isSubscribed
              ? "Manage your subscription details and billing."
              : "Unlock all features and remove limits."}
          </p>
        </div>

        {isSubscribed ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border bg-muted/50 p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-primary" />
                <p className="font-medium">You are currently on the Pro Plan</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground pl-7">
                Thank you for supporting Teak! You have access to all premium
                features.
              </p>
            </div>

            <CustomerPortalButton className={cn(buttonVariants({}))}>
              Manage Subscription & Billing
              <ExternalLink />
            </CustomerPortalButton>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <PlanOption
                planId={monthlyPlanId}
                title="Monthly"
                priceAmount={1900}
                intervalLabel="Per Month"
                buttonVariant="outline"
              />
              <PlanOption
                planId={yearlyPlanId}
                title="Yearly"
                priceAmount={9900}
                intervalLabel="Per Year"
                badge="Best Value • 20% off"
                buttonVariant="destructive"
              />
            </div>

            <div className="space-y-3 text-left rounded-md bg-muted/30 p-4">
              <p className="font-medium text-sm text-muted-foreground">
                Pro Features included:
              </p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {featureList.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4 text-primary shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
