"use client";

import { CustomerPortalLink } from "@convex-dev/polar/react";
import { buttonVariants } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { api } from "@teak/convex";

export function SubscriptionActions() {
  return (
    <CustomerPortalLink
      polarApi={{
        // @ts-ignore
        generateCustomerPortalUrl: api.billing.generateCustomerPortalUrl,
      }}
      className={buttonVariants({
        variant: "outline",
      })}
    >
      Manage
      <ExternalLink />
    </CustomerPortalLink>
  );
}
