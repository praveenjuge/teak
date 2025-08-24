import { useUser } from "@clerk/nextjs";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { CheckoutLink, CustomerPortalLink } from "@convex-dev/polar/react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FREE_TIER_LIMIT } from "@teak/shared/constants";
import { ExternalLink } from "lucide-react";

export default function SubscriptionPage() {
  const { user } = useUser();

  const products = useQuery(api.polar.listAllProducts);
  const subscription = useQuery(api.polar.userHasPremium);
  const cardCount = useQuery(api.cards.getCardCount);

  if (!user) return null;

  const isSubscribed = !!subscription;
  const progressPercentage = isSubscribed
    ? 100
    : Math.min(((cardCount || 0) / FREE_TIER_LIMIT) * 100, 100);

  return (
    <div className="mx-auto md:min-w-2xl space-y-6">
      <div className="space-x-2 flex items-center">
        <h1 className="text-base font-bold">Subscription</h1>
        {isSubscribed ? (
          <Badge>Pro Plan</Badge>
        ) : (
          <Badge variant="secondary">Free Plan</Badge>
        )}
      </div>

      {/* Cards Usage Progress */}
      <div className="space-y-3">
        <h2>
          {isSubscribed
            ? `${cardCount || 0} cards used - You have unlimited cards 🎉`
            : `${cardCount || 0} / ${FREE_TIER_LIMIT} cards used`}
        </h2>
        <Progress value={progressPercentage} className="h-2" />
        {!isSubscribed && (cardCount || 0) >= FREE_TIER_LIMIT && (
          <p className="text-destructive">
            You&apos;ve reached your free tier limit. Upgrade to Pro for
            unlimited cards.
          </p>
        )}
      </div>

      {/* Customer Portal (if subscribed) */}
      {isSubscribed && (
        <CustomerPortalLink
          polarApi={{
            generateCustomerPortalUrl: api.polar.generateCustomerPortalUrl,
          }}
          className={buttonVariants()}
        >
          Manage Subscription
          <ExternalLink />
        </CustomerPortalLink>
      )}

      {!isSubscribed && products && products.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-semibold">Available Plans</h2>
          <div className="flex gap-2">
            {products.map(
              (product: {
                id: string;
                name: string;
                prices: { id: string; priceAmount?: number }[];
              }) => (
                <CheckoutLink
                  key={product.id}
                  polarApi={{
                    generateCheckoutLink: api.polar.generateCheckoutLink,
                  }}
                  productIds={[product.id]}
                  className={buttonVariants()}
                >
                  <span>
                    {product.name} — $
                    {(product.prices[0]?.priceAmount || 0) / 100}
                  </span>
                </CheckoutLink>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
