import type { MutationCtx } from "../_generated/server";
import type { ServerEventCatalog, ServerEventName } from "../shared/analytics";
import type { PostHogProperties } from "../shared/posthog";
import { ignoreTelemetryErrorAsync } from "../shared/telemetry";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { queueAnalyticsEvent } from "../workflowDispatch";
import { type InboundEmailEventArgs, recordInboundEmailEvent } from "./events";
import { backendAppVersion, isBackendCaptureEnabled } from "./posthog";

/**
 * Mutations cannot fetch, so they queue each event in the workflow dispatch
 * outbox and the Files Worker sends a flush's events in one PostHog request.
 * The event matches `captureBackendEvent`'s. Property names can't start with
 * `$` (Convex reserves them).
 */
export const queueBackendEvent = async <Name extends ServerEventName>(
  ctx: MutationCtx,
  event: Name,
  distinctId: string | undefined,
  properties: ServerEventCatalog[Name],
  options: { set?: PostHogProperties } = {}
): Promise<void> => {
  // A deployment without a Files Worker could never send the row.
  if (!(isBackendCaptureEnabled() && isFilesWorkerConfigured())) {
    return;
  }
  const appVersion = backendAppVersion();
  await ignoreTelemetryErrorAsync(() =>
    queueAnalyticsEvent(ctx, {
      ...(appVersion ? { appVersion } : {}),
      ...(distinctId ? { distinctId } : {}),
      event,
      properties: { surface: "backend", ...properties },
      ...(options.set ? { set: options.set } : {}),
      timestamp: new Date().toISOString(),
      uuid: crypto.randomUUID(),
    })
  );
};

export const queueCardOutcome = async (
  ctx: MutationCtx,
  args: {
    cardId?: string;
    cardType?: string;
    errorClass?: string;
    outcome: "success" | "failure";
    source?: string;
    userId?: string;
  }
): Promise<void> => {
  const properties = {
    card_type: args.cardType ?? "unknown",
    source: args.source ?? "unknown",
  };
  if (args.outcome === "success") {
    await queueBackendEvent(ctx, "card_created", args.userId, properties);
  } else {
    await queueBackendEvent(ctx, "card_create_failed", args.userId, {
      ...properties,
      error_class: args.errorClass,
    });
  }
};

export const queueUserCreated = async (
  ctx: MutationCtx,
  args: { email?: string; source?: string; userId: string }
): Promise<void> => {
  await queueBackendEvent(
    ctx,
    "user_signed_up",
    args.userId,
    { source: args.source },
    {
      set: {
        ...(args.email ? { email: args.email } : {}),
        plan: "free",
        signed_up_at: new Date().toISOString(),
      },
    }
  );
};

export const queueCardProcessingFailed = async (
  ctx: MutationCtx,
  args: {
    cardType?: string;
    errorClass: string;
    stage: string;
    userId?: string;
  }
): Promise<void> => {
  await queueBackendEvent(ctx, "card_processing_failed", args.userId, {
    card_type: args.cardType,
    error_class: args.errorClass,
    stage: args.stage,
  });
};

export const queueInboundEmailEvent = (
  ctx: MutationCtx,
  args: InboundEmailEventArgs
): Promise<void> =>
  recordInboundEmailEvent(args, (event, properties) =>
    queueBackendEvent(ctx, event, args.userId, properties)
  );
