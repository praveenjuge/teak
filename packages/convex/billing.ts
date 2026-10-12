import { Polar, type WebhookEventHandlers } from "@convex-dev/polar";
import { Polar as PolarBilling } from "@polar-sh/sdk";
import { ConvexError, v } from "convex/values";
import { api, components } from "./_generated/api";
import { action, env, query } from "./_generated/server";
import { readIsDevDeployment } from "./env";
import { getSessionProfile } from "./securitySessions";
import { isApprovedPolarProductId } from "./shared/polarPlans";
import { normalizeErrorClass } from "./shared/telemetry";
import {
  captureBackendEvent,
  captureBackendException,
} from "./telemetry/posthog";

// User query to use in the Polar component
export const getUserInfoHandler = async (ctx: any) => {
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

export const polarUserInfoProvider = async (
  ctx: any
): Promise<{ userId: string; email: string; name?: string }> => {
  const user = await ctx.runQuery(api.billing.getUserInfo);
  if (!user?.email) {
    throw new ConvexError("User not found");
  }

  return {
    userId: user.teakUserId,
    email: user.email,
  };
};

export const polar = new Polar(components.polar, {
  getUserInfo: polarUserInfoProvider,
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

export const createCheckoutLinkHandler = async (ctx: any, args: any) => {
  let userId: string | undefined;
  try {
    const user = await ctx.runQuery(api.billing.getUserInfo);
    userId = user.teakUserId;
    if (!isApprovedPolarProductId(args.productId)) {
      throw new ConvexError("Invalid product");
    }
    const polar = new PolarBilling({
      accessToken: env.POLAR_ACCESS_TOKEN ?? "",
      server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });

    const dbCustomer = await ctx.runQuery(
      components.polar.lib.getCustomerByUserId,
      {
        userId: user.teakUserId,
      }
    );
    const createCustomer = async () => {
      const customer = await polar.customers.create(
        polarCustomerIdentity(user, readIsDevDeployment())
      );
      if (!customer.id) {
        throw new Error("Customer not created");
      }
      return customer.id;
    };
    const customerId = dbCustomer?.id || (await createCustomer());

    if (!dbCustomer) {
      await ctx.runMutation(components.polar.lib.insertCustomer, {
        id: customerId,
        userId: user.teakUserId,
      });
    }

    const checkout = await polar.checkouts.create({
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

export const createCustomerPortalHandler = async (ctx: any) => {
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

    const polarSdk = new PolarBilling({
      accessToken: env.POLAR_ACCESS_TOKEN ?? "",
      server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
    });

    const result = await polarSdk.customerSessions.create({
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

interface PolarSubscriptionEvent {
  data: {
    customer: {
      externalId?: string | null;
      metadata: Record<string, unknown>;
    };
  };
}

// Customers carry the Teak user id in metadata (see polarCustomerIdentity).
const subscriptionOwner = (
  event: PolarSubscriptionEvent
): string | undefined => {
  const { customer } = event.data;
  const fromMetadata = customer.metadata.userId;
  return typeof fromMetadata === "string"
    ? fromMetadata
    : (customer.externalId ?? undefined);
};

/** Polar webhooks that move a person's plan in product analytics. */
export const polarWebhookEvents: WebhookEventHandlers = {
  "subscription.created": (_ctx, event) =>
    captureBackendEvent(
      "checkout_completed",
      subscriptionOwner(event),
      {},
      { set: { plan: "pro" } }
    ),
  "subscription.revoked": (_ctx, event) =>
    captureBackendEvent(
      "subscription_ended",
      subscriptionOwner(event),
      {},
      { set: { plan: "free" } }
    ),
};
