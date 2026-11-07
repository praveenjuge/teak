import type { WebhookEventHandlers } from "@convex-dev/polar";
import type { Polar as PolarApi } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { api, components } from "./_generated/api";
import {
  type ActionCtx,
  action,
  type QueryCtx,
  query,
} from "./_generated/server";
import { polar, polarCustomerOwnerId, requirePolarApi } from "./billing/polar";
import { readBillingDisabled, readIsDevDeployment } from "./env";
import { getSessionProfile } from "./securitySessions";
import { isApprovedPolarProductId } from "./shared/polarPlans";
import { normalizeErrorClass } from "./shared/telemetry";
import {
  captureBackendEvent,
  captureBackendException,
} from "./telemetry/posthog";

export const BILLING_DISABLED_ERROR = {
  code: "BILLING_DISABLED",
  message: "Billing is off on this deployment.",
} as const;

const assertBillingEnabled = () => {
  if (readBillingDisabled()) {
    throw new ConvexError(BILLING_DISABLED_ERROR);
  }
};

// Whether this deployment sells plans. The web app hides Plan and its
// Billing buttons when it doesn't; everyone then has Pro (auth.ts).
export const getBillingStatus = query({
  args: {},
  returns: v.object({ enabled: v.boolean() }),
  handler: () => ({ enabled: !readBillingDisabled() }),
});

export const getUserInfoHandler = async (ctx: QueryCtx) => {
  const profile = await getSessionProfile(ctx);
  if (!profile) {
    throw new ConvexError("User not found");
  }
  return { teakUserId: profile.teakUserId, email: profile.user.email };
};

export const getUserInfo = query({
  args: {},
  handler: getUserInfoHandler,
});

// Polar's sandbox refuses customer emails whose domain can't receive mail, and
// the shared dev deployment's seeded accounts sign in on reserved domains
// (dev+<machine>-<checkout>@example.org; WorkOS claims example.com for its
// test org). There the Polar customer gets an alias on Teak's own mail domain,
// with the real address kept in metadata. Polar customers map back to users by
// customer ID (the component's customers table), never by email, so
// subscription sync is unaffected. Production always uses the real address.
const DEV_POLAR_CUSTOMER_EMAIL_DOMAIN = "teakvault.com";
const RESERVED_EMAIL_DOMAIN =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

const polarCustomerIdentity = (
  user: { teakUserId: string; email: string },
  isDevDeployment: boolean
): { email: string; metadata: Record<string, string> } => {
  const domain = user.email.split("@").pop()?.toLowerCase() ?? "";
  if (!(isDevDeployment && RESERVED_EMAIL_DOMAIN.test(domain))) {
    return { email: user.email, metadata: { userId: user.teakUserId } };
  }
  const alias = user.teakUserId.replace(/[^A-Za-z0-9_-]/g, "-");
  return {
    email: `teak-dev+${alias}@${DEV_POLAR_CUSTOMER_EMAIL_DOMAIN}`,
    metadata: { userId: user.teakUserId, email: user.email },
  };
};

/**
 * Returns the Polar customer Teak maps to this user, creating one if there is
 * none. Two checkouts at once can both create one; the component keeps the
 * first mapping, so the loser uses that customer and deletes its own, which
 * nothing else would ever see.
 */
const ensurePolarCustomer = async (
  ctx: ActionCtx,
  polarClient: PolarApi,
  user: { teakUserId: string; email: string }
): Promise<string> => {
  const existing = await ctx.runQuery(
    components.polar.lib.getCustomerByUserId,
    { userId: user.teakUserId }
  );
  if (existing?.id) {
    return existing.id;
  }
  const created = await polarClient.customers.create(
    polarCustomerIdentity(user, readIsDevDeployment())
  );
  if (!created.id) {
    throw new Error("Customer not created");
  }
  await ctx.runMutation(components.polar.lib.insertCustomer, {
    id: created.id,
    userId: user.teakUserId,
  });
  const stored = await ctx.runQuery(components.polar.lib.getCustomerByUserId, {
    userId: user.teakUserId,
  });
  if (!stored?.id) {
    throw new Error("Customer not stored");
  }
  if (stored.id !== created.id) {
    await polarClient.customers
      .delete({ id: created.id })
      .catch((error: unknown) =>
        captureBackendException(error, {
          distinctId: user.teakUserId,
          properties: { operation: "billing", stage: "duplicate_customer" },
        })
      );
  }
  return stored.id;
};

export const createCheckoutLinkHandler = async (
  ctx: ActionCtx,
  args: { productId: string }
) => {
  assertBillingEnabled();
  let userId: string | undefined;
  try {
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.teakUserId;
    if (!isApprovedPolarProductId(args.productId)) {
      throw new ConvexError("Invalid product");
    }
    const polarClient = requirePolarApi();
    const customerId = await ensurePolarCustomer(ctx, polarClient, user);

    const checkout = await polarClient.checkouts.create({
      products: [args.productId],
      allowDiscountCodes: true,
      customerId,
    });

    return checkout.url;
  } catch (error) {
    await captureBackendEvent("checkout_failed", userId, {
      error_class: normalizeErrorClass(error),
    });
    throw error;
  }
};

export const createCheckoutLink = action({
  args: { productId: v.string() },
  returns: v.string(),
  handler: createCheckoutLinkHandler,
});

export const createCustomerPortalHandler = async (ctx: ActionCtx) => {
  assertBillingEnabled();
  let userId: string | undefined;
  try {
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.teakUserId;
    const subscription = await polar.getCurrentSubscription(ctx, {
      userId: user.teakUserId,
    });
    if (!subscription?.customerId) {
      throw new ConvexError("No active subscription found");
    }

    const result = await requirePolarApi().customerSessions.create({
      customerId: subscription.customerId,
    });

    await captureBackendEvent("billing_portal_opened", userId, {});
    return result.customerPortalUrl;
  } catch (error) {
    await captureBackendException(error, {
      distinctId: userId,
      properties: { operation: "billing", stage: "portal" },
    });
    throw error;
  }
};

export const createCustomerPortal = action({
  args: {},
  returns: v.string(),
  handler: createCustomerPortalHandler,
});

const isPolarNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  error.statusCode === 404;

/**
 * Ends a deleted owner's billing: Polar cancels any active subscription at
 * once, revokes benefits and anonymizes the customer, keeping past orders for
 * tax records. Owners who never started checkout have no customer. Safe to
 * repeat; a customer Polar already deleted is done.
 */
export const closeBillingCustomer = async (
  ctx: ActionCtx,
  teakUserId: string
): Promise<void> => {
  const customer = await ctx.runQuery(
    components.polar.lib.getCustomerByUserId,
    { userId: teakUserId }
  );
  if (!customer) {
    return;
  }
  try {
    await requirePolarApi().customers.delete({
      id: customer.id,
      anonymize: true,
    });
  } catch (error) {
    if (!isPolarNotFound(error)) {
      throw error;
    }
  }
};

export const polarWebhookEvents: WebhookEventHandlers = {
  "subscription.created": (_ctx, event) =>
    captureBackendEvent(
      "checkout_completed",
      polarCustomerOwnerId(event.data.customer),
      {},
      { set: { plan: "pro" } }
    ),
  "subscription.revoked": (_ctx, event) =>
    captureBackendEvent(
      "subscription_ended",
      polarCustomerOwnerId(event.data.customer),
      {},
      { set: { plan: "free" } }
    ),
};
