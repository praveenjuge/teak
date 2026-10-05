"use node";

import { createHash } from "node:crypto";
import { NotFoundException, type User, WorkOS } from "@workos-inc/node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction } from "./_generated/server";

function credentials() {
  const apiKey = process.env.WORKOS_API_KEY,
    environmentId = process.env.WORKOS_ENVIRONMENT_ID,
    clientId = process.env.WORKOS_CLIENT_ID;
  if (!(apiKey && environmentId && clientId)) {
    throw new Error("Missing reconciliation credentials");
  }
  return {
    workos: new WorkOS(apiKey, { clientId, maxRetries: 0, timeout: 10_000 }),
    environmentId,
    clientId,
    apiKeyFingerprint: createHash("sha256").update(apiKey).digest("hex"),
  };
}
function profile(user: User) {
  return {
    email: user.email,
    emailVerified: user.emailVerified,
    externalId: user.externalId ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    profilePictureUrl: user.profilePictureUrl ?? null,
  };
}
async function witness(workos: WorkOS, id: string) {
  const user = await workos.userManagement.getUser(id);
  if (user.id !== id) {
    throw new Error("Reconciliation witness mismatch");
  }
}
async function observe(
  ctx: ActionCtx,
  workos: WorkOS,
  id: string,
  witnessId: string,
  externalId?: string | null
) {
  const expectedState = await ctx.runQuery(
    internal.workosProfileApply.captureWorkosProfileState,
    { workosUserId: id, ...(externalId === undefined ? {} : { externalId }) }
  );
  try {
    const user = await workos.userManagement.getUser(id);
    if (user.id !== id) {
      throw new Error("Reconciliation provider ID mismatch");
    }
    return {
      workosUserId: id,
      expectedState,
      state: {
        kind: "active" as const,
        profile: profile(user),
        providerUpdatedAt: user.updatedAt,
      },
    };
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }
    // A list omission or arbitrary 404-shaped error is never absence proof.
    // Re-check the pinned known provider immediately before a destructive commit.
    await witness(workos, witnessId);
    return {
      workosUserId: id,
      expectedState,
      state: { kind: "deleted" as const },
    };
  }
}
async function runPage(ctx: ActionCtx, runId: Id<"workosReconciliationRuns">) {
  const { workos, ...identity } = credentials();
  const run: Doc<"workosReconciliationRuns"> | null = await ctx.runMutation(
    internal.workosReconciliation.claim,
    { runId, ...identity }
  );
  if (!run) {
    return null;
  }
  try {
    await witness(workos, run.providerWitnessUserId);
    if (run.phase === "census") {
      await ctx.runMutation(internal.workosReconciliationCensus.checkpoint, {
        runId,
        generation: run.generation,
      });
      return null;
    }
    const base = {
      ...identity,
      runId,
      generation: run.generation,
      phase: run.phase as "events" | "provider" | "owners",
    };
    if (run.phase === "events") {
      const page = await workos.events.listEvents({
        events: ["user.created", "user.updated", "user.deleted"],
        after: run.eventCursor,
        rangeStart: run.rangeStart,
        rangeEnd: run.rangeEnd,
        limit: 100,
        order: "asc",
      });
      const events = page.data.flatMap((envelope) =>
        envelope.event === "user.created" ||
        envelope.event === "user.updated" ||
        envelope.event === "user.deleted"
          ? [
              {
                id: envelope.id,
                createdAt: envelope.createdAt,
                event: envelope.event,
                data: envelope.data,
                ...(envelope.context ? { context: envelope.context } : {}),
              },
            ]
          : []
      );
      assertCredentials(identity);
      await ctx.runMutation(internal.workosReconciliation.checkpoint, {
        ...base,
        cursor: run.eventCursor,
        nextCursor: page.listMetadata.after ?? undefined,
        done: !page.listMetadata.after,
        events,
        observations: [],
      });
    } else {
      const page:
        | { data: User[]; listMetadata: { after: string | null } }
        | { page: string[]; isDone: boolean; continueCursor: string } =
        run.phase === "provider"
          ? await workos.userManagement.listUsers({
              after: run.providerCursor,
              limit: 20,
              order: "asc",
            })
          : await ctx.runQuery(internal.workosReconciliation.owners, {
              cursor: run.ownerCursor ?? null,
            });
      const provider = "data" in page;
      const ids = provider ? page.data.map((user) => user.id) : page.page;
      const observations: Awaited<ReturnType<typeof observe>>[] = [];
      for (const id of new Set(ids)) {
        observations.push(
          await observe(
            ctx,
            workos,
            id,
            run.providerWitnessUserId,
            provider
              ? (page.data.find((user) => user.id === id)?.externalId ?? null)
              : undefined
          )
        );
      }
      assertCredentials(identity);
      let nextCursor: string | undefined;
      if (provider) {
        nextCursor = page.listMetadata.after ?? undefined;
      } else if (!page.isDone) {
        nextCursor = page.continueCursor;
      }
      await ctx.runMutation(internal.workosReconciliation.checkpoint, {
        ...base,
        cursor: provider ? run.providerCursor : run.ownerCursor,
        nextCursor,
        done: provider ? !page.listMetadata.after : page.isDone,
        events: [],
        observations,
      });
    }
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : undefined;
    const providerRetry =
      typeof error === "object" && error !== null && "retryAfter" in error
        ? Number(error.retryAfter) * 1000
        : 0;
    const retryable =
      status === 429 ||
      (status !== undefined && status >= 500) ||
      (status === undefined &&
        !(
          error instanceof Error &&
          /mismatch|cursor|Invalid|Inactive|Missing/.test(error.message)
        ));
    await ctx.runMutation(internal.workosReconciliation.interruption, {
      runId,
      generation: run.generation,
      reason: status === undefined ? "interrupted" : `provider_${status}`,
      ...(retryable
        ? {
            retryDelayMs: Math.max(
              providerRetry,
              Math.min(3_600_000, 1000 * 2 ** Math.min(run.retryCount, 12))
            ),
          }
        : {}),
    });
  }
  return null;
}
function assertCredentials(admitted: {
  environmentId: string;
  clientId: string;
  apiKeyFingerprint: string;
}) {
  const current = credentials();
  if (
    current.environmentId !== admitted.environmentId ||
    current.clientId !== admitted.clientId ||
    current.apiKeyFingerprint !== admitted.apiKeyFingerprint
  ) {
    throw new Error("Reconciliation credential mismatch");
  }
}
export const start = internalAction({
  args: {
    runKey: v.string(),
    environmentId: v.string(),
    clientId: v.string(),
    providerWitnessUserId: v.string(),
    mode: v.union(v.literal("audit"), v.literal("repair")),
    rangeStart: v.string(),
    rangeEnd: v.string(),
  },
  returns: v.id("workosReconciliationRuns"),
  handler: async (ctx, args): Promise<Id<"workosReconciliationRuns">> => {
    const { workos, ...identity } = credentials();
    if (
      args.environmentId !== identity.environmentId ||
      args.clientId !== identity.clientId
    ) {
      throw new Error("Reconciliation environment mismatch");
    }
    await witness(workos, args.providerWitnessUserId);
    const runId: Id<"workosReconciliationRuns"> = await ctx.runMutation(
      internal.workosReconciliation.admit,
      { ...args, apiKeyFingerprint: identity.apiKeyFingerprint }
    );
    await runPage(ctx, runId);
    return runId;
  },
});
export const resume = internalAction({
  args: { runId: v.id("workosReconciliationRuns") },
  returns: v.null(),
  handler: runPageArgs,
});
function runPageArgs(
  ctx: ActionCtx,
  args: { runId: Id<"workosReconciliationRuns"> }
) {
  return runPage(ctx, args.runId);
}
