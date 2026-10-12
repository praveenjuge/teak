import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

type ScheduledFunction = Parameters<MutationCtx["scheduler"]["runAfter"]>[1];

const telemetryFunctions = (
  internal as unknown as {
    telemetry: {
      events: {
        emitCardOutcome: ScheduledFunction;
        emitCardProcessingFailed: ScheduledFunction;
        emitUserCreated: ScheduledFunction;
      };
    };
  }
).telemetry.events;

// Mutations cannot fetch, so each outcome schedules one action that sends it.

export const scheduleCardOutcome = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    cardId?: string;
    cardType?: string;
    errorClass?: string;
    outcome: "success" | "failure";
    source?: string;
    userId?: string;
    workflowId?: string;
  }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(0, telemetryFunctions.emitCardOutcome, args);
  } catch {
    // Scheduling telemetry must never alter the product mutation.
  }
};

export const scheduleUserCreated = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: { email?: string; source?: string; userId: string }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(0, telemetryFunctions.emitUserCreated, args);
  } catch {
    // Scheduling telemetry must never alter the product mutation.
  }
};

export const scheduleCardProcessingFailed = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    cardType?: string;
    errorClass: string;
    stage: string;
    userId?: string;
  }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(
      0,
      telemetryFunctions.emitCardProcessingFailed,
      args
    );
  } catch {
    // Scheduling telemetry must never alter the workflow.
  }
};
