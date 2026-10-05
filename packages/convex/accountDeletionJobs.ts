import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./workflows/manager";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
export const getState = internalQuery({
  args: bindingArgs,
  handler: async (ctx, { stateId, generation }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation) {
      throw new Error("stale_deletion_generation");
    }
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
      .take(2);
    if (owners.length !== 1 || owners[0].workosUserId !== state.workosUserId) {
      throw new Error("deletion_binding_changed");
    }
    return state;
  },
});
// Protected E2E callers validate canonical authority before this durable lookup.
// Provider absence cannot mark unfinished local cleanup complete.
export const getDeletionStatus = internalQuery({
  args: { userId: v.string(), email: v.string(), workosUserId: v.string() },
  handler: async (ctx, { userId, email, workosUserId }) => {
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
      .take(2);
    if (owners.length === 0) {
      return { status: "missing" as const };
    }
    if (
      owners.length !== 1 ||
      owners[0].workosUserId !== workosUserId ||
      owners[0].workosEmail?.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      return { status: "conflict" as const };
    }
    const states = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(2);
    if (
      states.length > 1 ||
      (states[0] && states[0].workosUserId !== workosUserId)
    ) {
      return { status: "conflict" as const };
    }
    if (states[0]) {
      return {
        status: "pending" as const,
        userId,
        stage: states[0].stage,
        failureCode: states[0].failureCode,
      };
    }
    return {
      status:
        owners[0].deletedAt === undefined
          ? ("missing" as const)
          : ("completed" as const),
      userId,
    };
  },
});

export const advance = internalMutation({
  args: { ...bindingArgs, stage: v.number() },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, stage }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== stage) {
      throw new Error("stale_deletion_stage");
    }
    await ctx.db.patch("accountDeletionStates", stateId, {
      stage: stage + 1,
      failureCode: undefined,
    });
    return null;
  },
});
export const saveSessionCursor = internalMutation({
  args: {
    ...bindingArgs,
    previous: v.union(v.string(), v.null()),
    next: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, previous, next }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (
      !state ||
      state.generation !== generation ||
      state.stage !== 1 ||
      (state.providerSessionCursor ?? null) !== previous
    ) {
      throw new Error("stale_deletion_session_page");
    }
    await ctx.db.patch("accountDeletionStates", stateId, {
      providerSessionCursor: next,
    });
    return null;
  },
});
export const finalize = internalMutation({
  args: bindingArgs,
  returns: v.null(),
  handler: async (ctx, { stateId, generation }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== 6) {
      throw new Error("stale_deletion_stage");
    }
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
      .take(2);
    if (owners.length !== 1 || owners[0].workosUserId !== state.workosUserId) {
      throw new Error("deletion_binding_changed");
    }
    await ctx.db.patch("users", owners[0]._id, {
      deletedAt: owners[0].deletedAt ?? Date.now(),
    });
    await ctx.db.delete("accountDeletionStates", stateId);
    return null;
  },
});
export const revokeLocalPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      args
    );
    const keys: boolean = await ctx.runMutation(
      internal.apiKeys.revokeDeletionKeysPage,
      { ownerId: state.userId }
    );
    return keys;
  },
});
export const revokeConsentPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding) => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== 0) {
      throw new Error("stale_deletion_stage");
    }
    const page = await ctx.db
      .query("workosConsents")
      .withIndex("by_userId_and_firstSeenAt", (q) =>
        q.eq("userId", state.userId)
      )
      .paginate({ numItems: 100, cursor: state.localConsentCursor ?? null });
    for (const row of page.page) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch("workosConsents", row._id, {
          revokedAt: Date.now(),
        });
      }
    }
    // The revocations and cursor commit together. A lost action response resumes
    // from this durable page without revisiting all earlier grants.
    await ctx.db.patch("accountDeletionStates", state._id, {
      localConsentCursor: page.continueCursor,
    });
    return page.isDone;
  },
});
export const redrive = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const states = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_nextAttemptAt", (q) =>
        q.gt("nextAttemptAt", 0).lte("nextAttemptAt", Date.now())
      )
      .take(20);
    for (const state of states) {
      if (!state.workflowId || state.generation === undefined) {
        continue;
      }
      const status = await workflow.status(
        ctx,
        state.workflowId as Parameters<typeof workflow.status>[1]
      );
      if (status.type === "failed" || status.type === "canceled") {
        // Restart only terminated executions. A running action can still write externally.
        await workflow.restart(
          ctx,
          state.workflowId as Parameters<typeof workflow.restart>[1]
        );
      }
      await ctx.db.patch("accountDeletionStates", state._id, {
        nextAttemptAt: Date.now() + 300_000,
      });
    }
    return null;
  },
});

export const recordFailure = internalMutation({
  args: {
    ...bindingArgs,
    stage: v.number(),
    reason: v.optional(
      v.union(
        v.literal("storage_source_changed"),
        v.literal("object_write_pending")
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, stage, reason }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== stage) {
      return null;
    }
    const failureCode = `account_deletion_stage_${stage}_${reason ?? "failed"}`;
    await ctx.db.patch("accountDeletionStates", stateId, {
      failureCode,
      nextAttemptAt: Date.now() + 300_000,
    });
    console.error("account_deletion_retry_required", {
      stateId,
      stage,
      failureCode,
      requiresOperatorResolution: reason === "storage_source_changed",
      storageKind: state.storageProgress?.kind,
      completedKeyCount: state.storageProgress?.offset,
    });
    return null;
  },
});
