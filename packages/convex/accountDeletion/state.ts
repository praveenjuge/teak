import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Names one deletion attempt: its state row and generation. */
export const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
/**
 * The deletion this run belongs to, and the one owner it still deletes:
 * a stale generation or an owner row that changed stops the run.
 */
export const readDeletionBinding = async (
  ctx: Pick<QueryCtx, "db">,
  {
    stateId,
    generation,
  }: { stateId: Id<"accountDeletionStates">; generation: number }
): Promise<{
  owner: Doc<"users">;
  state: Doc<"accountDeletionStates">;
}> => {
  const state = await ctx.db.get("accountDeletionStates", stateId);
  if (!state || state.generation !== generation) {
    throw new Error("stale_deletion_generation");
  }
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
    .take(2);
  const owner = owners[0];
  if (owners.length !== 1 || owner?.workosUserId !== state.workosUserId) {
    throw new Error("deletion_binding_changed");
  }
  return { owner, state };
};

export const readDeletionState = async (
  ctx: Pick<QueryCtx, "db">,
  binding: { stateId: Id<"accountDeletionStates">; generation: number }
): Promise<Doc<"accountDeletionStates">> =>
  (await readDeletionBinding(ctx, binding)).state;
