export const POLAR_PLAN_IDS = {
  development: {
    monthly: "a02153cd-c49d-49ae-8be6-464296a39a23",
    yearly: "f3073c34-8b4d-40b7-8123-2f8cbacbc609",
  },
  production: {
    monthly: "d46c71a7-61dc-4dc8-b090-f0e03cb7de56",
    yearly: "6fb24b68-09e0-42c4-b090-f0e03cb7de56",
  },
} as const;

export type PolarPlanEnvironment = keyof typeof POLAR_PLAN_IDS;

export const getPolarPlanIds = (environment: PolarPlanEnvironment) =>
  POLAR_PLAN_IDS[environment];

export const APPROVED_POLAR_PRODUCT_IDS = new Set<string>([
  POLAR_PLAN_IDS.development.monthly,
  POLAR_PLAN_IDS.development.yearly,
  POLAR_PLAN_IDS.production.monthly,
  POLAR_PLAN_IDS.production.yearly,
]);

export const isApprovedPolarProductId = (
  productId: unknown
): productId is string =>
  typeof productId === "string" && APPROVED_POLAR_PRODUCT_IDS.has(productId);

interface PolarSubscriptionLike {
  product?: { id?: unknown } | null;
  productId?: unknown;
  status?: unknown;
}

export const subscriptionProductId = (
  subscription: PolarSubscriptionLike | null | undefined
): string | null => {
  if (typeof subscription?.productId === "string") {
    return subscription.productId;
  }
  if (typeof subscription?.product?.id === "string") {
    return subscription.product.id;
  }
  return null;
};

export const isApprovedActiveSubscription = (
  subscription: PolarSubscriptionLike | null | undefined
): boolean =>
  subscription?.status === "active" &&
  isApprovedPolarProductId(subscriptionProductId(subscription));
