import { preloadedQueryResult, preloadQuery } from "convex/nextjs";
import { api } from "@teak/convex";
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
import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { SubscriptionActions } from "@/components/subscription/SubscriptionActions";
import { PlanCard } from "@/components/subscription/PlanCard";
import { getAuthToken } from "../auth";

export default async function SubscriptionPage() {
  const token = await getAuthToken();

  // Preload all queries server-side
  const preloadedProducts = await preloadQuery(
    // @ts-ignore
    api.billing.listAllProducts,
    {},
    { token }
  );
  const preloadedSubscription = await preloadQuery(
    api.billing.userHasPremium,
    {},
    { token }
  );
  const preloadedcardCount = await preloadQuery(
    api.cards.getCardCount,
    {},
    { token }
  );

  // Access the preloaded data to calculate progress
  const subscription = preloadedQueryResult(preloadedSubscription);
  const cardCountValue = preloadedQueryResult(preloadedcardCount);

  const cardCount = typeof cardCountValue === "number" ? cardCountValue : 0;
  const isSubscribed = !!subscription;
  const progressPercentage = isSubscribed
    ? 100
    : Math.min((cardCount / FREE_TIER_LIMIT) * 100, 100);

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

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current Plan
            {isSubscribed && <Badge>Pro Plan</Badge>}
          </CardTitle>
          <CardDescription>Your subscription details</CardDescription>
          <CardAction>
            {isSubscribed && <SubscriptionActions />}
            {!isSubscribed && <Badge variant="secondary">Free Plan</Badge>}
          </CardAction>
        </CardHeader>
      </Card>

      {/* Usage Card */}
      <Card className="gap-3">
        <CardHeader>
          <CardTitle>Cards Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
                  You&apos;ve reached your free tier limit. Upgrade to Pro for
                  unlimited cards.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Plans Section */}
      <PlanCard
        preloadedProducts={preloadedProducts}
        preloadedSubscription={preloadedSubscription}
      />

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
                <span className="text-sm text-foreground">Unlimited cards</span>
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
    </div>
  );
}
