import type { MutationCtx } from "../_generated/server";
import type {
  ServerEventCatalog,
  ServerEventName,
  SignupMethod,
  SignupPlatform,
} from "../shared/analytics";
import type { PostHogProperties } from "../shared/posthog";
import { ignoreTelemetryErrorAsync } from "../shared/telemetry";
import { isCoreWorkerConfigured } from "../storage/coreWorkerClient";
import { queueAnalyticsEvent } from "../workflowDispatch/outbox";
import { type InboundEmailEventArgs, recordInboundEmailEvent } from "./events";
import {
  BACKEND_APP_VERSION,
  backendCommitSha,
  isBackendCaptureEnabled,
  isInternalAccount,
} from "./posthog";

/**
 * Mutations cannot fetch, so they queue each event in the workflow dispatch
 * outbox and the Core Worker sends a flush's events in one PostHog request.
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
  // A deployment without a Core Worker could never send the row.
  if (!(isBackendCaptureEnabled() && isCoreWorkerConfigured())) {
    return;
  }
  const commitSha = backendCommitSha();
  await ignoreTelemetryErrorAsync(() =>
    queueAnalyticsEvent(ctx, {
      appVersion: BACKEND_APP_VERSION,
      ...(distinctId ? { distinctId } : {}),
      event,
      properties: {
        surface: "backend",
        ...(commitSha ? { commit_sha: commitSha } : {}),
        ...properties,
      },
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
  args: {
    email?: string;
    method?: SignupMethod;
    platform?: SignupPlatform;
    source?: string;
    userId: string;
  }
): Promise<void> => {
  const platform = args.platform ?? "unknown";
  await queueBackendEvent(
    ctx,
    "user_signed_up",
    args.userId,
    {
      platform,
      source: args.source,
      ...(args.method ? { method: args.method } : {}),
    },
    {
      set: {
        ...(args.email ? { email: args.email } : {}),
        is_internal: isInternalAccount(args.email),
        plan: "free",
        signed_up_at: new Date().toISOString(),
        signup_platform: platform,
        ...(args.method ? { signup_method: args.method } : {}),
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
