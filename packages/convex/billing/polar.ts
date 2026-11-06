import { Polar } from "@convex-dev/polar";
import { Polar as PolarApi } from "@polar-sh/sdk";
import { ConvexError } from "convex/values";
import { api, components } from "../_generated/api";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import { readBillingDisabled, readPolarAccess } from "../env";
import { isApprovedActiveSubscription } from "../shared/polarPlans";

/**
 * Everything Teak knows about Polar: the component that mirrors customers
 * and subscriptions, the API client, who a Polar customer is in Teak, and
 * what a subscription entitles an account to. Checkout and the portal
 * (billing.ts) and the admin revenue views (adminBilling.ts) both read it
 * from here.
 */

export const polarUserInfoProvider = async (
  ctx: Pick<ActionCtx, "runQuery">
): Promise<{ userId: string; email: string; name?: string }> => {
  const user = await ctx.runQuery(api.billing.getUserInfo);
  if (!user?.email) {
    throw new ConvexError("User not found");
  }
  return { userId: user.teakUserId, email: user.email };
};

export const polar = new Polar(components.polar, {
  getUserInfo: polarUserInfoProvider,
});

// Polar calls run inside actions; a hung request would otherwise hold the
// action until Convex kills it.
const POLAR_TIMEOUT_MS = 15_000;

/** The Polar API, or null on a deployment without a Polar access token. */
export const polarApi = (): PolarApi | null => {
  const access = readPolarAccess();
  return access
    ? new PolarApi({ ...access, timeoutMs: POLAR_TIMEOUT_MS })
    : null;
};

/** The Polar API, for the calls a deployment that sells plans must make. */
export const requirePolarApi = (): PolarApi => {
  const client = polarApi();
  if (!client) {
    throw new Error("polar_not_configured");
  }
  return client;
};

/**
 * The Teak user a Polar customer belongs to: the user ID Teak writes into
 * the customer's metadata, else the customer's external ID.
 */
export const polarCustomerOwnerId = (customer: {
  externalId?: string | null;
  metadata: Record<string, unknown>;
}): string | undefined => {
  const fromMetadata = customer.metadata.userId;
  return typeof fromMetadata === "string"
    ? fromMetadata
    : (customer.externalId ?? undefined);
};

export type SubscriptionLookup = (
  ctx: Pick<QueryCtx, "runQuery">,
  args: { userId: string }
) => Promise<{ productId?: string; status?: string } | null | undefined>;

const currentSubscription: SubscriptionLookup = (ctx, args) =>
  polar.getCurrentSubscription(ctx, args);

/**
 * Whether the user pays for Pro: an active subscription to an approved
 * plan. A lookup that fails counts as none, so a failing lookup never lifts
 * the free limits, and is logged so the failure is seen.
 */
export const readHasPremium = async (
  ctx: Pick<QueryCtx, "runQuery">,
  userId: string,
  lookup: SubscriptionLookup = currentSubscription
): Promise<boolean> => {
  try {
    return isApprovedActiveSubscription(await lookup(ctx, { userId }));
  } catch (error) {
    console.error(
      "[billing] subscription lookup failed; applying free limits",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
    return false;
  }
};

/**
 * What the account may do: Pro with an active subscription, or everyone
 * while billing is off. `readHasPremium` stays the real subscription.
 */
export const readCardEntitlement = async (
  ctx: Pick<QueryCtx, "runQuery">,
  userId: string,
  lookup?: SubscriptionLookup
): Promise<boolean> =>
  readBillingDisabled() || (await readHasPremium(ctx, userId, lookup));
