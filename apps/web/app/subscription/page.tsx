"use client";

import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { CheckoutLink, CustomerPortalLink } from "@convex-dev/polar/react";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { FREE_TIER_LIMIT } from "@teak/shared/constants";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";

export default function SubscriptionPage() {
  const { user } = useUser();

  const products = useQuery(api.polar.listAllProducts);
  const subscription = useQuery(api.polar.userHasPremium);
  const cardCount = useQuery(api.cards.getCardCount);

  if (!user) return null;

  // Show loading state while subscription status is being fetched
  const isLoading = subscription === undefined;

  const isSubscribed = !!subscription;
  const progressPercentage = isSubscribed
    ? 100
    : Math.min(((cardCount || 0) / FREE_TIER_LIMIT) * 100, 100);

  return (
    <div className="container mx-auto max-w-3xl py-8 px-4 space-y-6">
      <div>
        <Link href="/" className="font-medium text-primary">
          &larr; Back
        </Link>
        <Separator className="my-4" />
        <h1 className="text-base font-bold text-foreground mb-1">
          Subscription
        </h1>
        <p className="text-muted-foreground">
          Manage your Teak subscription and billing settings
        </p>
      </div>

      {/* Show loading skeleton while data is loading */}
      {isLoading ? (
        <div className="grid h-96 place-items-center">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Current Plan Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Current Plan
                {isSubscribed && <Badge>Pro Plan</Badge>}
              </CardTitle>
              <CardDescription>Your subscription details</CardDescription>
              <CardAction>
                {isSubscribed && (
                  <CustomerPortalLink
                    polarApi={{
                      generateCustomerPortalUrl:
                        api.polar.generateCustomerPortalUrl,
                    }}
                    className={buttonVariants({
                      variant: "outline",
                    })}
                  >
                    Manage
                    <ExternalLink />
                  </CustomerPortalLink>
                )}
                {!isSubscribed && <Badge variant="secondary">Free Plan</Badge>}
              </CardAction>
            </CardHeader>
          </Card>

          {/* Usage Card */}
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Cards Usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progressPercentage} className="h-1.5" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {isSubscribed
                    ? `${cardCount || 0} cards created`
                    : `${cardCount || 0} / ${FREE_TIER_LIMIT} cards used`}
                </span>
                <span>
                  {isSubscribed ? "Unlimited ∞" : `${FREE_TIER_LIMIT} limit`}
                </span>
              </div>

              {!isSubscribed && (cardCount || 0) >= FREE_TIER_LIMIT && (
                <div className="pt-2">
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                    <p className="text-sm text-destructive">
                      You&apos;ve reached your free tier limit. Upgrade to Pro
                      for unlimited cards.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Available Plans Section */}
          {!isSubscribed && products && products.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 fill-primary text-primary" />
                  <CardTitle>Upgrade to Pro</CardTitle>
                </div>
                <CardDescription>
                  Unlock unlimited cards and premium features
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {products.map(
                    (product: {
                      id: string;
                      name: string;
                      prices: { id: string; priceAmount?: number }[];
                    }) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/30"
                      >
                        <div className="space-y-1">
                          <h3 className="font-medium text-foreground">
                            {product.name}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Unlimited cards, priority support, and more
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span className="text-2xl font-bold text-foreground">
                              ${(product.prices[0]?.priceAmount || 0) / 100}
                            </span>
                            <span className="text-sm text-muted-foreground ml-1">
                              /month
                            </span>
                          </div>
                          <CheckoutLink
                            polarApi={{
                              generateCheckoutLink:
                                api.polar.generateCheckoutLink,
                            }}
                            productIds={[product.id]}
                            className={buttonVariants({
                              className: "min-w-32",
                            })}
                          >
                            Upgrade Now
                          </CheckoutLink>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pro Features Section */}
          {isSubscribed && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 fill-primary text-primary" />
                  <CardTitle>Pro Features</CardTitle>
                </div>
                <CardDescription>
                  You have access to all premium features
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 bg-primary rounded-full" />
                    <span className="text-sm text-foreground">
                      Unlimited card creation
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 bg-primary rounded-full" />
                    <span className="text-sm text-foreground">
                      Priority customer support
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 bg-primary rounded-full" />
                    <span className="text-sm text-foreground">
                      Advanced organization features
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="size-1.5 bg-primary rounded-full" />
                    <span className="text-sm text-foreground">
                      Enhanced file storage
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
