import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { mirrorBetterAuthUser } from "../userIdentityTable";
import {
  assertHeldBarrier,
  importLeaseOwner,
  importLeasePins,
} from "./workosImportLease";
import { assertRollbackMode, inspectRollbackOwner } from "./workosRollbackPlan";

// The activation-reviewed dry run: exact owners per class, every
// owner-to-provider link, and every denied owner. Arrays hold at most 8192
// values, which bounds a single rollback to that many owners per class.
const reviewedScope = v.object({
  invalidate: v.array(v.string()),
  verify: v.array(v.string()),
  fences: v.array(v.string()),
  denied: v.array(v.string()),
  mappings: v.array(
    v.object({ teakUserId: v.string(), workosUserId: v.string() })
  ),
});

// Inert operator writer. Deployment does not approve or activate rollback.
// This wider reset policy requires its own approval, separate from activation.
export const applyPage = internalMutation({
  args: {
    ...importLeasePins,
    ...importLeaseOwner,
    cursor: v.union(v.string(), v.null()),
    passwordPolicy: v.literal("invalidate-all-mapped-legacy-passwords"),
    policyApprovalReference: v.string(),
    activationApprovalReference: v.string(),
    reviewed: reviewedScope,
  },
  returns: v.object({
    scanned: v.number(),
    invalidated: v.number(),
    verified: v.number(),
    deletionFences: v.number(),
    done: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (
      !(
        args.policyApprovalReference.trim() &&
        args.activationApprovalReference.trim()
      ) ||
      args.policyApprovalReference.length > 2048 ||
      args.activationApprovalReference.length > 2048
    ) {
      throw new Error(
        "Separate password policy and rollback activation approvals required"
      );
    }
    assertRollbackMode(args);
    await assertHeldBarrier(ctx, args);
    const page = await ctx.db
      .query("users")
      .paginate({ cursor: args.cursor, numItems: 20 });
    const inspections: Awaited<ReturnType<typeof inspectRollbackOwner>>[] = [];
    for (const row of page.page) {
      inspections.push(await inspectRollbackOwner(ctx, row));
    }
    if (inspections.some((item) => item.summary.blockers.length)) {
      throw new Error(
        "Rollback lifecycle blockers remain; retain account pause and barrier"
      );
    }
    // Provider events keep landing while account changes are paused. Checking
    // the page against the reviewed scope in this transaction, before any write,
    // means a swapped, relinked or newly deleted owner fails the whole page.
    const invalidate = new Set(args.reviewed.invalidate),
      verify = new Set(args.reviewed.verify),
      fences = new Set(args.reviewed.fences),
      denied = new Set(args.reviewed.denied),
      links = new Map(
        args.reviewed.mappings.map((link) => [
          link.teakUserId,
          link.workosUserId,
        ])
      );
    if (
      inspections.some(({ summary: owner }) => {
        const id = owner.teakUserId;
        return (
          (links.get(id) ?? null) !== owner.workosUserId ||
          (owner.invalidateLegacyPassword && !invalidate.has(id)) ||
          (owner.markSameEmailVerified && !verify.has(id)) ||
          (owner.promoteDeletion && !fences.has(id)) ||
          (owner.deniedDeleted && !denied.has(id))
        );
      })
    ) {
      throw new Error(
        "Rollback page is outside the reviewed dry run; nothing on this page was written"
      );
    }
    let invalidated = 0,
      verified = 0,
      deletionFences = 0;
    for (const item of inspections) {
      if (item.summary.promoteDeletion) {
        await ctx.db.patch("users", item.row._id, {
          deletedAt: item.providerDeletionAt,
          emailVerified: false,
        });
        deletionFences++;
      }
      if (item.summary.invalidateLegacyPassword && item.credential) {
        // Optional normal auth trigger handles are deliberately absent. This
        // internal transaction is fenced; normal auth writes remain blocked.
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "account",
            where: [{ field: "_id", value: item.credential._id }],
            update: { password: null, updatedAt: Date.now() },
          },
        });
        invalidated++;
      }
      if (item.summary.markSameEmailVerified && item.legacy) {
        await ctx.runMutation(components.betterAuth.adapter.updateOne, {
          input: {
            model: "user",
            where: [{ field: "_id", value: item.legacy._id }],
            update: { emailVerified: true, updatedAt: Date.now() },
          },
        });
        await mirrorBetterAuthUser(ctx, {
          ...item.legacy,
          emailVerified: true,
        });
        verified++;
      }
    }
    return {
      scanned: page.page.length,
      invalidated,
      verified,
      deletionFences,
      done: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
