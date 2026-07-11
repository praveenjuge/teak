import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

type ScheduledFunction = Parameters<MutationCtx["scheduler"]["runAfter"]>[1];

const telemetryFunctions = (
  internal as unknown as {
    telemetry: {
      events: {
        emitCardOutcome: ScheduledFunction;
        emitAuthOutcome: ScheduledFunction;
        emitBillingOutcome: ScheduledFunction;
        emitUploadOutcome: ScheduledFunction;
        emitUserCreated: ScheduledFunction;
      };
    };
  }
).telemetry.events;

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
  args: { source?: string; userId: string }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(0, telemetryFunctions.emitUserCreated, args);
  } catch {
    // Scheduling telemetry must never alter the product mutation.
  }
};

export const scheduleAuthOutcome = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    errorClass?: string;
    outcome: "attempt" | "success" | "failure";
    stage: "auth_bootstrap" | "session_refresh" | "sign_in";
    userId?: string;
  }
): Promise<boolean> => {
  try {
    await ctx.scheduler.runAfter(0, telemetryFunctions.emitAuthOutcome, args);
    return true;
  } catch {
    // Scheduling telemetry must never alter authentication.
    return false;
  }
};

export const scheduleBillingOutcome = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    errorClass?: string;
    flow: "checkout" | "portal";
    outcome: "attempt" | "success" | "failure";
    userId?: string;
  }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(
      0,
      telemetryFunctions.emitBillingOutcome,
      args
    );
  } catch {
    // Scheduling telemetry must never alter billing.
  }
};

export const scheduleUploadOutcome = async (
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    bytes?: number;
    durationMs?: number;
    errorClass?: string;
    fileBucket: string;
    outcome: "attempt" | "success" | "failure";
    userId?: string;
  }
): Promise<void> => {
  try {
    await ctx.scheduler.runAfter(0, telemetryFunctions.emitUploadOutcome, args);
  } catch {
    // Scheduling telemetry must never alter the product mutation.
  }
};
