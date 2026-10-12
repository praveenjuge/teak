/** Pricing math for the /pricing page, so copy never drifts from the prices. */

import { FREE_TIER_LIMIT } from "@teak/convex/shared/constants";

export const FREE_CARD_LIMIT = FREE_TIER_LIMIT;
export const PRO_MONTHLY_PRICE = 19;
export const PRO_YEARLY_PRICE = 99;

export const formatUsd = (amount: number) =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

/** Saving of yearly over twelve monthly payments, as a whole percent. */
export const yearlySavingsPercent = (
  monthly = PRO_MONTHLY_PRICE,
  yearly = PRO_YEARLY_PRICE
) => Math.round((1 - yearly / (monthly * 12)) * 100);

/** Yearly price spread over twelve months, rounded to the cent. */
export const yearlyPerMonth = (yearly = PRO_YEARLY_PRICE) =>
  Math.round((yearly / 12) * 100) / 100;
