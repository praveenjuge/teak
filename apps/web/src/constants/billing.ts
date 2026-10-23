export {
  getPolarPlanIds,
  POLAR_PLAN_IDS,
} from "@teak/convex/shared/polarPlans";

// Pro prices in cents. They match the Polar products and the docs pricing
// (`apps/docs/lib/pricing.ts`).
export const PRO_MONTHLY_PRICE_CENTS = 1900;
export const PRO_YEARLY_PRICE_CENTS = 9900;

/** How much a year on the yearly plan saves over twelve monthly payments. */
export const yearlySavingsPercent = (
  monthlyCents = PRO_MONTHLY_PRICE_CENTS,
  yearlyCents = PRO_YEARLY_PRICE_CENTS
) => Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
