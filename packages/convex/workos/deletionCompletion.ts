import type { QueryCtx } from "../_generated/server";

// Every applied `user.deleted` leaves this tombstone, even for a WorkOS user
// Teak never linked, so a token issued before the deletion can't create an
// owner. A linked owner also carries `workosDeletedAt`.
export async function hasWorkosDeletionReceipt(
  ctx: Pick<QueryCtx, "db">,
  workosUserId: string
): Promise<boolean> {
  const receipt = await ctx.db
    .query("migrationQuarantine")
    .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
      q.eq("workosUserId", workosUserId).eq("reason", "workos_user_deleted")
    )
    .first();
  return receipt !== null;
}
