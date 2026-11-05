import { api } from "@teak/convex";
import { useQuery } from "@/lib/convexQueryHooks";

/**
 * Whether this deployment sells plans. A self-hosted deployment with
 * BILLING_DISABLED gives everyone Pro, so Plan and its Billing buttons have
 * nothing to show. True while loading, so Teak's own app never flickers.
 */
export const useBillingEnabled = (): boolean =>
  useQuery(api.billing.getBillingStatus)?.enabled ?? true;
