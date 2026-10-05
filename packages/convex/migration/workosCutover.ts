import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { readAuthPrimary } from "../env";
import {
  assertHeldBarrier,
  importLeaseOwner,
  importLeasePins,
} from "./workosImportLease";

// Inert internal operator writer. Activation is separate from deployment approval.
// No users, credentials, cards, API keys or consent records are rewritten.
export const revokeLegacyPage = internalMutation({
  args: {
    ...importLeasePins,
    ...importLeaseOwner,
    model: v.union(v.literal("session"), v.literal("oauthAccessToken")),
  },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    await assertHeldBarrier(ctx, args);
    if (readAuthPrimary() !== "workos") {
      throw new Error(
        "Legacy revocation requires WorkOS primary after the approved flip"
      );
    }
    // Always read the first page: deleting rows then advancing a cursor could skip
    // credentials. An empty subsequent page is the completion proof.
    const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: args.model,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    for (const row of page.page) {
      if (!("_id" in row) || typeof row._id !== "string") {
        throw new Error("Malformed legacy revocation page");
      }
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: args.model, where: [{ field: "_id", value: row._id }] },
      });
    }
    return { deleted: page.page.length, done: page.page.length === 0 };
  },
});
