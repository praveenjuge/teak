import {
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
} from "@teak/convex/shared/constants";

export const yearlySavingsPercent = (
  monthlyCents = PRO_MONTHLY_PRICE_CENTS,
  yearlyCents = PRO_YEARLY_PRICE_CENTS
) => Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
