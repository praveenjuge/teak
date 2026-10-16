import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";

const LEGACY_USER_MODELS = [
  "session",
  "account",
  "oauthAccessToken",
  "oauthConsent",
  "twoFactor",
] as const;

// A WorkOS-created owner's `teak_` key is no Better Auth document ID, and
// looking one up would throw.
export const findLegacyBetterAuthUser = async (
  ctx: Pick<QueryCtx, "runQuery">,
  owner: Pick<Doc<"users">, "identityOrigin" | "teakUserId">
) =>
  owner.identityOrigin === "workos"
    ? null
    : await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: owner.teakUserId }],
      });

const LEGACY_COUNT_PAGE_SIZE = 200;
const LEGACY_COUNT_MAX_PAGES = 40;

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

export const deleteLegacyBetterAuthSessions = (
  ctx: Pick<ActionCtx, "runMutation">,
  betterAuthUserId: string
) => deleteLegacyModelRows(ctx, "session", betterAuthUserId);

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
