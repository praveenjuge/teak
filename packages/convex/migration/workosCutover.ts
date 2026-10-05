import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { readAuthPrimary } from "../env";
import {
  assertHeldBarrier,
  importLeaseOwner,
  importLeasePins,
} from "./workosImportLease";
import { classifyLegacyGrant } from "./workosLegacyGrants";

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

export const revokeNativeCodesPage = internalMutation({
  args: { ...importLeasePins, ...importLeaseOwner },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    await assertHeldBarrier(ctx, args);
    if (readAuthPrimary() !== "workos") {
      throw new Error(
        "Legacy revocation requires WorkOS primary after the approved flip"
      );
    }
    const rows = await ctx.db.query("nativeAuthCodes").take(20);
    for (const row of rows) {
      await ctx.db.delete("nativeAuthCodes", row._id);
    }
    return { deleted: rows.length, done: rows.length === 0 };
  },
});
export const revokePendingGrantsPage = internalMutation({
  args: {
    ...importLeasePins,
    ...importLeaseOwner,
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    deleted: v.number(),
    scanned: v.number(),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    blockedIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await assertHeldBarrier(ctx, args);
    if (readAuthPrimary() !== "workos") {
      throw new Error(
        "Legacy revocation requires WorkOS primary after the approved flip"
      );
    }
    if (args.cursor !== null && args.cursor.length > 8192) {
      throw new Error("Invalid grant scan cursor");
    }
    const page = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "verification",
      paginationOpts: { cursor: args.cursor, numItems: 20 },
    });
    let deleted = 0;
    const blockedIds: string[] = [];
    for (const row of page.page) {
      if (
        !("_id" in row && "identifier" in row && "value" in row) ||
        typeof row._id !== "string" ||
        typeof row.identifier !== "string" ||
        typeof row.value !== "string"
      ) {
        throw new Error("Malformed pending grant scan page");
      }
      const classification = classifyLegacyGrant(row);
      if (classification === "ambiguous") {
        blockedIds.push(row._id);
      }
      if (classification === "grant") {
        await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: "verification",
            where: [{ field: "_id", value: row._id }],
          },
        });
        deleted++;
      }
    }
    return {
      deleted,
      scanned: page.page.length,
      blockedIds,
      done: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
