import type { QueryCtx } from "../_generated/server";
import { isOnboardingCard, ONBOARDING_CARDS } from "../card/defaultCards";
import { DAY_MS } from "./dates";
import { ACTIVATION_CARD_THRESHOLD, ACTIVATION_WINDOW_DAYS } from "./stats";

/**
 * Who counts as an activated user, for the admin overview and the metrics
 * cohorts alike: someone whose first week has ended and who saved at least
 * ACTIVATION_CARD_THRESHOLD cards of their own (onboarding cards don't
 * count) in it.
 */

const ACTIVATION_WINDOW_MS = ACTIVATION_WINDOW_DAYS * DAY_MS;

/** Whether the user's first week, the one activation looks at, has ended. */
export const activationWindowEnded = (createdAt: number, now: number) =>
  createdAt <= now - ACTIVATION_WINDOW_MS;

/**
 * Cards the user saved between `from` and `to`, not counting onboarding
 * cards, up to the activation threshold: past it the exact number doesn't
 * matter to any admin view.
 */
export const savedCardsBetween = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  from: number,
  to: number
): Promise<number> => {
  const rows = await ctx.db
    .query("cards")
    .withIndex("by_created", (q) =>
      q.eq("userId", userId).gte("createdAt", from).lt("createdAt", to)
    )
    .take(ACTIVATION_CARD_THRESHOLD + ONBOARDING_CARDS.length);
  return rows.filter((card) => !isOnboardingCard(card)).length;
};

export const savedCardsFirstWeek = (
  ctx: Pick<QueryCtx, "db">,
  user: { createdAt: number; teakUserId: string }
) =>
  savedCardsBetween(
    ctx,
    user.teakUserId,
    user.createdAt,
    user.createdAt + ACTIVATION_WINDOW_MS
  );

export const isActivated = (
  createdAt: number,
  cardsFirstWeek: number,
  now: number
) =>
  activationWindowEnded(createdAt, now) &&
  cardsFirstWeek >= ACTIVATION_CARD_THRESHOLD;
