import {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
} from "@teak/convex/shared/constants";

export {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
} from "@teak/convex/shared/constants";
export {
  getPolarPlanIds,
  POLAR_PLAN_IDS,
} from "@teak/convex/shared/polarPlans";

export const yearlySavingsPercent = (
  monthlyCents = PRO_MONTHLY_PRICE_CENTS,
  yearlyCents = PRO_YEARLY_PRICE_CENTS
) => Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
