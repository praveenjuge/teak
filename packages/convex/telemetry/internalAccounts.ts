import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import {
  isInternalAccount,
  setBackendPersonProperties,
  withBackendTelemetryScope,
} from "./posthog";

const PAGE_SIZE = 200;

export const listAccountsPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("users").paginate(paginationOpts);
    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      page: result.page
        .filter((user) => user.deletedAt === undefined && user.teakUserId)
        .map(({ email, teakUserId }) => ({ email, teakUserId })),
    };
  },
});

/**
 * Sets the `is_internal` person property on every live account from
 * `isInternalAccount`. New accounts get it with `user_signed_up`; run this
 * once after deploying it and again after changing
 * `POSTHOG_INTERNAL_ACCOUNTS`:
 * `npx convex run telemetry/internalAccounts:syncInternalAccounts --prod`.
 */
export const syncInternalAccounts = internalAction({
  args: {},
  returns: v.object({ accounts: v.number(), internal: v.number() }),
  handler: async (ctx) => {
    let cursor: string | null = null;
    let accounts = 0;
    let internalCount = 0;
    for (;;) {
      const result: {
        continueCursor: string;
        isDone: boolean;
        page: { email: string; teakUserId: string }[];
      } = await ctx.runQuery(
        internal.telemetry.internalAccounts.listAccountsPage,
        { paginationOpts: { cursor, numItems: PAGE_SIZE } }
      );
      await withBackendTelemetryScope({}, async () => {
        for (const { email, teakUserId } of result.page) {
          const isInternal = isInternalAccount(email);
          accounts += 1;
          internalCount += isInternal ? 1 : 0;
          await setBackendPersonProperties(teakUserId, {
            is_internal: isInternal,
          });
        }
      });
      if (result.isDone) {
        return { accounts, internal: internalCount };
      }
      cursor = result.continueCursor;
    }
  },
});
