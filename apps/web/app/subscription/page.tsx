"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { CheckoutLink, CustomerPortalLink } from "@convex-dev/polar/react";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import { api } from "@teak/convex";
import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import Loading from "../loading";
import Logo from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TopPattern } from "@/components/patterns/TopPattern";
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

export default function SubscriptionPage() {
  // @ts-ignore Convex Polar bindings aren't typed in the generated client yet
  const products = useQuery(api.billing.listAllProducts, {});
  const subscription = useQuery(api.billing.userHasPremium, {});
  const cardCountResult = useQuery(api.cards.getCardCount, {});

  if (
    products === undefined ||
    subscription === undefined ||
    cardCountResult === undefined
  ) {
    return <Loading />;
  }

  const { isSubscribed, cardCount } = useMemo(() => {
    const count = typeof cardCountResult === "number" ? cardCountResult : 0;
    const subscribed = subscription === true;

    return {
      isSubscribed: subscribed,
      cardCount: count,
    };
  }, [cardCountResult, subscription]);

  const productList = Array.isArray(products) ? products : [];
  const sortedProducts = useMemo(() => {
    return [...productList].sort((a, b) => {
      const aAmount = a?.prices?.[0]?.priceAmount ?? 0;
      const bAmount = b?.prices?.[0]?.priceAmount ?? 0;
      return aAmount - bAmount;
    });
  }, [productList]);

  const monthlyProduct =
    sortedProducts.find((product) => /month/i.test(product?.name || "")) ??
    sortedProducts[0];
  const yearlyProduct =
    sortedProducts.find((product) =>
      /(year|annual)/i.test(product?.name || "")
    ) ?? sortedProducts.find((product) => product?.id !== monthlyProduct?.id);

  const monthlyPrice = monthlyProduct?.prices?.[0]?.priceAmount ?? 0;
  const yearlyPrice = yearlyProduct?.prices?.[0]?.priceAmount ?? 0;

  const cardsUsedLabel = useMemo(() => {
    if (cardCountResult === undefined) {
      return "Calculating cards…";
    }

    if (isSubscribed) {
      return `${cardCount} Cards Used`;
    }

    return `${cardCount}/${FREE_TIER_LIMIT} Cards Used`;
  }, [cardCount, cardCountResult, isSubscribed]);

  return (
    <>
      <div className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center gap-10 px-4 py-20 text-center">
        <Link href="/" className="flex items-center gap-2 text-primary">
          <Logo variant="primary" />
        </Link>

        <div className="space-y-8 w-full">
          <Badge
            className="rounded-full"
            variant={isSubscribed ? "default" : "outline"}
          >
            {isSubscribed
              ? `You are on Pro Plan • ${cardsUsedLabel}`
              : `You are on Free Plan • ${cardsUsedLabel}`}
          </Badge>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {isSubscribed ? (
              <>
                Thank you for
                <br />
                being a Pro.
              </>
            ) : (
              <>
                Upgrade to
                <br />
                Go Further
              </>
            )}
          </h1>

          {isSubscribed ? (
            <div className="flex h-full flex-col justify-between rounded-md border bg-background p-6 text-left backdrop-blur-sm gap-4">
              <p className="font-medium text-muted-foreground">
                Your Pro Features:
              </p>

              <ul className="space-y-3">
                {featureList.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-primary" />
                    <span className="font-medium text-foreground">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <CustomerPortalLink
                polarApi={{
                  generateCustomerPortalUrl:
                    // @ts-ignore
                    api.billing.generateCustomerPortalUrl,
                }}
                className={cn(
                  buttonVariants({
                    variant: "outline",
                  })
                )}
              >
                Manage
                <ExternalLink />
              </CustomerPortalLink>

              <div className="border-t pt-4">
                <p className="text-muted-foreground">
                  Your support means the world and helps us build Teak better
                  every day.
                </p>

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src="https://github.com/praveenjuge.png"
                      alt="Praveen Juge"
                      className="size-7 bg-muted rounded-full"
                    />
                    <svg
                      height="26"
                      fill="currentColor"
                      viewBox="0 0 277 59"
                      xmlns="http://www.w3.org/2000/svg"
                      role="presentation"
                    >
                      {" "}
                      <title>Praveen Juge</title>{" "}
                      <path d="M9.1 24.56c-1.62-.12-1.74-.54-2.4-.54-1.26 0-1.86.48-1.86 1.08 0 .9 1.38 1.98 3.72 1.98h.18c-.78 5.1-2.52 10.02-4.8 13.68-.24.24-.9 1.08-.9 1.5 0 .6.6 1.14 1.44 1.14 1.44 0 1.98-1.2 2.46-2.1 2.28-4.38 3.48-8.64 5.64-14.46 10.56-1.44 18.48-8.64 18.48-16.2 0-4.98-4.38-9.42-14.94-9.42-4.98 0-11.1.96-13.92 3.48C1.54 5.3.94 6.08.94 7.28c0 .72.18 1.32.42 1.92 1.32 3.24 7.86 8.28 7.86 14.16 0 .42-.06.78-.12 1.2Zm6.66-20.34c8.76 0 12.18 3.6 12.18 7.56 0 5.88-6.3 11.4-14.4 12.6 2.28-6.12 4.32-13.32 4.8-17.46 0-.18.06-.36.06-.48 0-.84-.36-1.5-1.32-1.5-1.08 0-1.62.9-1.74 1.98-.48 4.02-2.34 10.92-4.56 17.7h-.48v-.18c0-7.2-5.16-11.7-6.9-16.08-.12-.36-.18-.48-.18-.6 0-2.58 10.02-3.54 12.54-3.54Zm23.5488 28.32c0-4.32-4.44-6.18-4.44-8.34 0-.78.78-1.8.78-2.4v-.06c0-.6-.72-1.44-1.5-1.44-.54 0-.78.18-.84.24-1.5 1.5-1.86 2.82-1.86 4.32 0 .6.36 1.08.84 1.56-.72 1.02-1.56 2.16-2.52 3.12-.18.18-.24.36-.24.54 0 .72 1.02 1.38 1.8 1.38.24 0 .42-.06.54-.18 1.2-1.2 1.92-2.28 2.34-3.3 1.26 1.02 2.52 2.4 2.52 4.74 0 1.8-1.2 3.6-1.2 4.68 0 .72.48.96 1.26.96 3.24 0 11.82-4.98 13.92-7.08.18-.18.24-.36.24-.54 0-.72-1.02-1.38-1.8-1.38-.24 0-.42.06-.54.18-1.8 1.8-7.38 5.94-9.12 5.94-.3 0-.54-.12-.54-.48 0-.78.36-1.62.36-2.46Zm17.8471-7.44c-5.94 0-10.08 5.16-10.08 8.46 0 1.56.9 2.7 2.94 2.7 2.88 0 5.58-1.92 8.16-4.02.12-.12.3-.18.42-.18.06 0 .24 0 .3.12 2.16 3 3.24 4.02 5.22 4.02 2.52 0 5.22-1.68 8.46-4.92.18-.18.24-.36.24-.54 0-.72-1.02-1.38-1.8-1.38-.24 0-.42.06-.54.18-2.82 2.82-4.2 4.44-5.34 4.44-1.14 0-1.98-1.14-3.66-4.14-.24-.42-1.02-.48-1.68-.48-2.28 0-4.74 4.14-8.16 4.14-.6 0-.9-.54-.9-1.26 0-1.74 2.1-4.74 6.42-4.74 1.14 0 2.34.42 3.42 1.08.12.06.3.06.42.06.78 0 1.5-.72 1.5-1.5 0-1.92-3.6-2.04-5.34-2.04Zm39.0155 6.18c.18-.18.24-.3.24-.54 0-.72-.72-1.56-1.5-1.56-.3 0-.6.12-.84.36-1.14 1.14-3.78 1.8-6.48 1.8-.96 0-1.74-.36-2.34-1.14.66-1.2 1.14-2.34 1.14-3.42 0-1.74-.96-2.94-3.42-2.94-.84 0-1.62 1.08-1.62 2.88 0 1.26.36 2.34.96 3.3-1.92 2.76-5.64 5.88-6.24 5.88-.72 0-1.98-3.54-1.98-8.22 0-1.74-.54-2.46-1.2-2.46-1.08 0-2.52 1.98-2.52 4.74 0 6.36 2.88 8.7 4.68 8.7 1.68 0 6.24-3.18 9-6.72 1.44 1.14 3.24 1.8 4.98 1.8 2.76 0 5.4-.72 7.14-2.46Zm1.3547-1.68c.9-1.38 2.5799-2.52 4.3799-2.52 2.04 0 3.06.6 3.06 1.38 0 .66-1.92 1.5-5.9399 1.5-.6 0-1.08-.12-1.5-.36Zm-.72 1.68c1.02.66 2.34 1.02 3.4799 1.02 4.98 0 7.5-2.04 7.5-3.9 0-1.92-1.92-3.72-5.88-3.72-5.2199 0-8.6399 3.96-8.6399 7.44 0 2.76 2.1 5.22 6.9599 5.22 6.72 0 15.9-3.96 18-6.06.12-.12.12-.18.12-.3 0-.66-1.14-1.56-1.86-1.56-.12 0-.3.06-.36.12-1.8 1.74-5.76 5.04-14.52 5.04-3.5999 0-4.8599-1.26-4.8599-2.76 0-.18 0-.36.06-.54Zm22.8099-1.68c.9-1.38 2.58-2.52 4.38-2.52 2.04 0 3.06.6 3.06 1.38 0 .66-1.92 1.5-5.94 1.5-.6 0-1.08-.12-1.5-.36Zm-.72 1.68c1.02.66 2.34 1.02 3.48 1.02 4.98 0 7.5-2.04 7.5-3.9 0-1.92-1.92-3.72-5.88-3.72-5.22 0-8.64 3.96-8.64 7.44 0 2.76 2.1 5.22 6.96 5.22 6.72 0 15.9-3.96 18-6.06.12-.12.12-.18.12-.3 0-.66-1.14-1.56-1.86-1.56-.12 0-.3.06-.36.12-1.8 1.74-5.76 5.04-14.52 5.04-3.6 0-4.86-1.26-4.86-2.76 0-.18 0-.36.06-.54Zm22.39-.42c.36-.96 1.62-2.04 1.62-3.18 0-.78-.96-1.5-2.1-1.5-2.4 0-4.08 6.54-4.08 8.46 0 .78.72 1.5 1.5 1.5 1.26 0 1.2-1.14 1.8-1.8 3.54-3.96 6.06-5.34 7.98-5.34 4.02 0 5.22 8.1 9.66 8.1s10.02-4.26 11.94-5.82c.18-.12.24-.36.24-.54 0-.72-.96-1.44-1.74-1.44-.24 0-.42.06-.6.24-3.42 3.3-5.88 4.68-7.56 4.68-5.28 0-4.26-7.74-8.94-7.74-2.04 0-5.1 1.14-9.72 4.38Zm44.064 17.1c-2.52 0-4.74-1.68-4.74-4.02 0-4.5 4.38-8.94 15.18-14.94.42-.24.66-.78.66-1.32 0-.72-.54-1.32-1.26-1.32-.36 0-.84.12-1.2.42-9.54 8.34-16.38 11.46-16.38 17.52 0 3.66 2.58 6.24 6.3 6.24 16.74 0 23.46-19.38 26.7-41.04.18-1.08.3-2.16.3-3.12 0-3.36-1.32-5.82-5.16-5.82-5.16 0-9.48 4.44-11.34 6.06-.66.6-1.26 1.38-1.26 2.58 0 1.26.54 1.74 1.08 1.74.6 0 1.2-.54 1.2-1.26 0-1.32 4.14-7.08 8.4-7.08 2.46 0 3.42 1.92 3.42 4.92 0 12.78-7.14 40.44-21.9 40.44Zm28.079-11.16c2.46 0 5.58-2.04 6.78-3.12.36 1.92 1.98 2.64 3.96 2.64 3.6 0 8.64-2.52 11.16-5.04.18-.18.24-.36.24-.54 0-.72-1.02-1.38-1.8-1.38-.24 0-.42.06-.54.18-2.82 2.82-5.7 4.32-7.26 4.32-1.44 0-2.28-1.26-2.28-4.08 0-.36-.66-.42-1.26-.42-.66 0-1.8.66-1.98 1.26-.3 1.14-4.26 4.02-6 4.02-.9 0-1.44-.9-1.44-2.04 0-1.2.48-2.46.48-3.78 0-1.26-.84-3.42-1.8-3.42-1.32 0-2.1 3.42-2.1 6.24 0 3.18 1.5 5.16 3.84 5.16Zm9.877 16.68c0-3.48 9.24-8.94 17.58-13.62.06.54.06 1.08.06 1.56 0 9.12-9.84 14.04-15.6 14.04-1.2 0-2.04-.6-2.04-1.98Zm16.2-26.46c-.12 0-.3-.06-.48-.06-.3 0-.6.06-.96.18-4.98 1.5-7.26 3.78-7.26 6.6 0 2.34 1.2 3.3 2.64 3.3 2.16 0 4.08-2.04 5.94-4.56 0 0 .66 2.1 1.14 4.74-9.24 5.88-20.52 13.38-20.52 18.3 0 2.22 1.32 3.24 3.42 3.24 7.14 0 20.46-6.84 20.46-18.72 0-.54-.12-1.14-.24-1.68 4.56-2.52 8.4-4.8 9.84-6.24.36-.36.54-.78.54-1.26 0-.84-.6-1.68-1.26-1.68-.24 0-.54.12-.78.36-1.32 1.32-4.8 3.54-9.12 6.24-.54-1.44-1.14-2.76-1.14-3.96 0-2.88 3.72-6.72 3.72-8.88v-.06c0-.6-.72-1.44-1.5-1.44-1.62 0-2.76 2.76-4.44 5.58Zm-1.92 3.12c-1.32 2.16-2.46 3.9-2.88 3.9-.18 0-.3-.18-.3-.54 0-1.38.78-2.88 3.18-3.36Zm17.909-.54c.9-1.38 2.58-2.52 4.38-2.52 2.04 0 3.06.6 3.06 1.38 0 .66-1.92 1.5-5.94 1.5-.6 0-1.08-.12-1.5-.36Zm-.72 1.68c1.02.66 2.34 1.02 3.48 1.02 4.98 0 7.5-2.04 7.5-3.9 0-1.92-1.92-3.72-5.88-3.72-5.22 0-8.64 3.96-8.64 7.44 0 2.76 2.1 5.22 6.96 5.22 6.72 0 15.9-3.96 18-6.06.12-.12.12-.18.12-.3 0-.66-1.14-1.56-1.86-1.56-.12 0-.3.06-.36.12-1.8 1.74-5.76 5.04-14.52 5.04-3.6 0-4.86-1.26-4.86-2.76 0-.18 0-.36.06-.54Z"></path>{" "}
                    </svg>
                  </div>
                  <Link
                    href="https://x.com/praveenjuge"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "ghost" })}
                    aria-label="Praveen Juge on X"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 15 15"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M13.2497 0.75L8.30808 6.525M8.30808 6.525L13.9047 12.8875C14.3331 13.375 13.9406 14.0833 13.2439 14.0833H12.0156C11.7564 14.0833 11.5122 13.9775 11.3539 13.7975L6.52474 8.30833M8.30808 6.525L3.47891 1.03583C3.32058 0.855833 3.07558 0.75 2.81724 0.75H1.58891C0.891411 0.75 0.499745 1.45833 0.928078 1.94583L6.52474 8.30833M1.58308 14.0833L6.52474 8.30833"
                        stroke="#020617"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
              <div className="grid gap-4">
                {monthlyProduct && (
                  <PlanOption
                    planId={monthlyProduct.id}
                    title="Monthly"
                    priceAmount={monthlyPrice}
                    intervalLabel="Per Month"
                    buttonVariant="outline"
                  />
                )}
                {yearlyProduct && (
                  <PlanOption
                    planId={yearlyProduct.id}
                    title="Yearly"
                    priceAmount={yearlyPrice}
                    intervalLabel="Per Year"
                    badge="Best Value • 20% off"
                    buttonVariant="destructive"
                  />
                )}
              </div>

              <div className="space-y-3 text-left">
                <p className="font-medium text-muted-foreground">
                  Pro Features:
                </p>
                <ul className="space-y-3">
                  {featureList.map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <CheckCircle2 className="size-4 text-primary" />
                      <span className="font-medium">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <TopPattern />
    </>
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
  buttonVariant,
}: PlanOptionProps) {
  const formattedPrice = priceAmount
    ? `${(priceAmount / 100).toLocaleString()}$`
    : "--";

  return (
    <div className="flex h-full flex-col justify-between rounded-md border bg-background p-5 text-left gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-muted-foreground">{title}</p>
        {badge && <Badge className="rounded-full">{badge}</Badge>}
      </div>
      <div className="flex justify-between items-end">
        <div className="flex gap-2 items-end">
          <p className="text-4xl font-semibold text-foreground">
            {formattedPrice}
          </p>
          <p className="text-muted-foreground pb-1">{intervalLabel}</p>
        </div>

        <CheckoutLink
          polarApi={{
            // @ts-ignore
            generateCheckoutLink: api.billing.generateCheckoutLink,
          }}
          productIds={[planId]}
          className={cn(
            buttonVariants({
              variant: buttonVariant,
            })
          )}
        >
          Continue
          <ArrowRight />
        </CheckoutLink>
      </div>
    </div>
  );
}
