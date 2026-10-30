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
