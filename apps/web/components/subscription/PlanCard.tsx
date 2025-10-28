"use client";

import { usePreloadedQuery, Preloaded } from "convex/react";
import { CheckoutLink } from "@convex-dev/polar/react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { api } from "@teak/convex";

interface PlanCardProps {
  // @ts-ignore
  preloadedProducts: Preloaded<typeof api.billing.listAllProducts>;
  preloadedSubscription: Preloaded<typeof api.billing.userHasPremium>;
}

export function PlanCard({
  preloadedProducts,
  preloadedSubscription,
}: PlanCardProps) {
  const products = usePreloadedQuery(preloadedProducts);
  const subscription = usePreloadedQuery(preloadedSubscription);

  const isSubscribed = !!subscription;

  if (isSubscribed || !products || products.length === 0) {
    return null;
  }

  return (
    <Card className="gap-4">
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
                  <div>
                    <span className="text-2xl font-bold text-foreground">
                      ${(product.prices[0]?.priceAmount || 0) / 100}
                    </span>
                    <span className="text-sm text-muted-foreground ml-1">
                      /month
                    </span>
                  </div>
                </div>
                <CheckoutLink
                  polarApi={{
                    // @ts-ignore
                    generateCheckoutLink: api.billing.generateCheckoutLink,
                  }}
                  productIds={[product.id]}
                  className={buttonVariants({})}
                >
                  Upgrade Now
                </CheckoutLink>
              </div>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
