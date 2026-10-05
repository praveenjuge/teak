import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

const dayMs = 86_400_000;
// Audit scheduling never activates repair or import.
export const dailyAudit = internalAction({
  args: {},
  returns: v.object({
    status: v.string(),
    runId: v.optional(v.id("workosReconciliationRuns")),
  }),
  handler: async (
    ctx
  ): Promise<{
    status: string;
    runId?: Doc<"workosReconciliationRuns">["_id"];
  }> => {
    const mode = process.env.WORKOS_RECONCILIATION_MODE;
    if (!mode || mode === "off") {
      return { status: "disabled" };
    }
    if (mode !== "audit") {
      throw new Error("Scheduled reconciliation only permits audit");
    }
    const environmentId = process.env.WORKOS_ENVIRONMENT_ID,
      clientId = process.env.WORKOS_CLIENT_ID,
      providerWitnessUserId = process.env.WORKOS_RECONCILIATION_WITNESS_ID;
    if (!(environmentId && clientId && providerWitnessUserId)) {
      throw new Error("Missing daily reconciliation pins");
    }
    const latest: Doc<"workosReconciliationRuns"> | null = await ctx.runQuery(
      internal.workosReconciliation.latest,
      { environmentId }
    );
    if (
      latest &&
      (latest.clientId !== clientId ||
        latest.providerWitnessUserId !== providerWitnessUserId)
    ) {
      throw new Error("Daily reconciliation pin mismatch");
    }
    if (latest?.phase === "failed") {
      return { status: "failed_requires_operator", runId: latest._id };
    }
    if (latest && latest.phase !== "complete") {
      if (latest.mode !== "audit") {
        return { status: "repair_active_requires_operator", runId: latest._id };
      }
      await ctx.runAction(internal.workosReconciliationActions.resume, {
        runId: latest._id,
      });
      return { status: "resumed", runId: latest._id };
    }
    const audit: Doc<"workosReconciliationRuns"> | null = await ctx.runQuery(
      internal.workosReconciliation.latestAudit,
      { environmentId }
    );
    const end = Math.floor(Date.now() / dayMs) * dayMs;
    if (
      audit?.phase === "complete" &&
      audit.censusComplete === true &&
      Date.parse(audit.rangeEnd) >= end
    ) {
      return {
        status: "already_dispatched",
        runId: audit._id,
      };
    }
    const previousEnd =
      audit?.phase === "complete" && audit.censusComplete === true
        ? Date.parse(audit.rangeEnd)
        : end - dayMs;
    const start = previousEnd - 60_000;
    if (start < Date.now() - 90 * dayMs) {
      return { status: "event_retention_gap_requires_operator" };
    }
    const boundedEnd = Math.min(end, start + 30 * dayMs);
    const rangeStart = new Date(start).toISOString(),
      rangeEnd = new Date(boundedEnd).toISOString();
    const runId = await ctx.runAction(
      internal.workosReconciliationActions.start,
      {
        environmentId,
        clientId,
        providerWitnessUserId,
        mode: "audit",
        runKey: `daily-audit:${environmentId}:${rangeStart}:${rangeEnd}`,
        rangeStart,
        rangeEnd,
      }
    );
    return { status: "admitted", runId };
  },
});
