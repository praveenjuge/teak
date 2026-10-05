import type { MutationCtx } from "../_generated/server";
import { readAccountChangesPaused, readAuthPrimary } from "../env";

// Called from component triggers in the credential write transaction. An HTTP
// action's earlier environment snapshot cannot authorize a post-barrier write.
export async function assertLegacyCredentialWrite(ctx: MutationCtx) {
  const barriers = await ctx.db
    .query("workosImportLeases")
    .withIndex("by_scope", (q) => q.eq("scope", "management_import"))
    .take(2);
  if (
    readAuthPrimary() !== "betterauth" ||
    barriers.length > 1 ||
    barriers[0]?.status === "quiesced"
  ) {
    throw new Error(
      "Legacy credential writes are stopped for the auth transition"
    );
  }
}

export async function assertLegacyAccountWrite(ctx: MutationCtx) {
  if (readAccountChangesPaused()) {
    throw new Error(
      "Legacy account changes are paused for the auth transition"
    );
  }
  await assertLegacyCredentialWrite(ctx);
}

export async function assertLegacyProtectedProfileWrite(
  ctx: MutationCtx,
  next: { email: string; emailVerified: boolean },
  previous: { email: string; emailVerified: boolean }
) {
  // Login timestamps/name/avatar refreshes remain valid in Better Auth during
  // the pause; only account authority changes require the transactional fence.
  if (
    next.email !== previous.email ||
    next.emailVerified !== previous.emailVerified
  ) {
    await assertLegacyAccountWrite(ctx);
  }
}
