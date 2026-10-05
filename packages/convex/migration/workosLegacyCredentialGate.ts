import type { MutationCtx } from "../_generated/server";
import { readAuthPrimary } from "../env";

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
