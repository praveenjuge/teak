import { components } from "./_generated/api";
import type { ActionCtx, QueryCtx } from "./_generated/server";

// The Better Auth component stays mounted only for rows retained from before
// WorkOS. Apart from the backup exporter, this is the only module that reads
// or writes them: account deletion finds a legacy owner's user and removes
// every row keyed to it, and admin stats count them. Removing the retained data itself needs separate
// owner approval.

const LEGACY_USER_MODELS = [
  "session",
  "account",
  "oauthAccessToken",
  "oauthConsent",
  "twoFactor",
] as const;

// Owners WorkOS created have a `teak_` key, which is not a Better Auth
// document ID, so callers look up only owners from before WorkOS.
export const findLegacyBetterAuthUser = (
  ctx: Pick<QueryCtx, "runQuery">,
  teakUserId: string
) =>
  ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "_id", value: teakUserId }],
  });

const LEGACY_COUNT_PAGE_SIZE = 200;
const LEGACY_COUNT_MAX_PAGES = 50;

// Counts retained Better Auth users, reading only their IDs. Stops after a
// bounded number of pages and reports whether the count is complete.
export async function countLegacyBetterAuthUsers(
  ctx: Pick<QueryCtx, "runQuery">
): Promise<{ count: number; isComplete: boolean }> {
  let count = 0;
  let cursor: string | null = null;
  for (let page = 0; page < LEGACY_COUNT_MAX_PAGES; page++) {
    const result: { page: unknown[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: "user",
        select: ["_id"],
        paginationOpts: { cursor, numItems: LEGACY_COUNT_PAGE_SIZE },
      });
    count += result.page.length;
    if (result.isDone) {
      return { count, isComplete: true };
    }
    cursor = result.continueCursor;
  }
  return { count, isComplete: false };
}

type LegacyUserModel = (typeof LEGACY_USER_MODELS)[number];

async function deleteLegacyModelRows(
  ctx: Pick<ActionCtx, "runMutation">,
  model: LegacyUserModel,
  betterAuthUserId: string
) {
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result: { isDone: boolean; continueCursor: string } =
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model, where: [{ field: "userId", value: betterAuthUserId }] },
        paginationOpts: { cursor, numItems: 100 },
      });
    if (result.isDone) {
      return;
    }
    cursor = result.continueCursor;
  }
  throw new Error("deletion_legacy_rows_unbounded");
}

// Session revocation removes legacy sessions with the provider's.
export const deleteLegacyBetterAuthSessions = (
  ctx: Pick<ActionCtx, "runMutation">,
  betterAuthUserId: string
) => deleteLegacyModelRows(ctx, "session", betterAuthUserId);

// Sessions, accounts, OAuth grants and consents, two-factor secrets, then the
// user. Verification rows are keyed by email or token, not user, and expire
// on their own. No delete trigger runs: account deletion finalization records
// the owner's tombstone and redacts its address.
export async function deleteLegacyBetterAuthRows(
  ctx: Pick<ActionCtx, "runMutation">,
  betterAuthUserId: string
) {
  for (const model of LEGACY_USER_MODELS) {
    await deleteLegacyModelRows(ctx, model, betterAuthUserId);
  }
  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: {
      model: "user",
      where: [{ field: "_id", value: betterAuthUserId }],
    },
  });
}
