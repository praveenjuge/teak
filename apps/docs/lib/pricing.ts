import {
  FREE_TIER_LIMIT,
  PRO_MONTHLY_PRICE_CENTS,
  PRO_YEARLY_PRICE_CENTS,
} from "@teak/convex/shared/constants";

export const FREE_CARD_LIMIT = FREE_TIER_LIMIT;
export const PRO_MONTHLY_PRICE = PRO_MONTHLY_PRICE_CENTS / 100;
export const PRO_YEARLY_PRICE = PRO_YEARLY_PRICE_CENTS / 100;

export const formatUsd = (amount: number) =>
  Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

export const yearlySavingsPercent = (
  monthly = PRO_MONTHLY_PRICE,
  yearly = PRO_YEARLY_PRICE
) => Math.round((1 - yearly / (monthly * 12)) * 100);

export const yearlyPerMonth = (yearly = PRO_YEARLY_PRICE) =>
  Math.round((yearly / 12) * 100) / 100;
