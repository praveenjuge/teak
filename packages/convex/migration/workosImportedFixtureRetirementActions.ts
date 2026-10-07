"use node";

import { NotFoundException, WorkOS } from "@workos-inc/node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { assertImportedFixtureTarget } from "./workosImportedFixtureRetirement";
import { importLeasePins } from "./workosImportLease";

// Inactive internal operator action for exactly one allowlisted retired
// fixture. It proves the provider user is gone right now (canonical SDK GET ->
// 404, no retries) before the mutation settles the matching deletion receipt.
// Never scheduled or HTTP-reachable; activation needs separate approval.
export const settleRetiredImportedFixture = internalAction({
  args: {
    ...importLeasePins,
    workosUserId: v.string(),
    teakUserId: v.string(),
    createdEventId: v.string(),
    deletedEventId: v.string(),
    deletedEventAt: v.number(),
    deletedQuarantineId: v.id("migrationQuarantine"),
    deletedQuarantineCreatedAt: v.number(),
  },
  returns: v.object({ resolvedAt: v.number(), alreadyResolved: v.boolean() }),
  handler: async (ctx, args) => {
    await assertImportedFixtureTarget(args);
    const apiKey = process.env.WORKOS_API_KEY as string;
    const workos = new WorkOS(apiKey, {
      clientId: args.clientId,
      maxRetries: 0,
      timeout: 10_000,
    });
    try {
      await workos.userManagement.getUser(args.workosUserId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return await ctx.runMutation(
          internal.migration.workosImportedFixtureRetirement
            .resolveRetiredImportedFixtureReceipt,
          { ...args, providerAbsentCheckedAt: Date.now() }
        );
      }
      throw new Error("Provider absence could not be verified");
    }
    throw new Error("Retired fixture still exists in WorkOS");
  },
});
