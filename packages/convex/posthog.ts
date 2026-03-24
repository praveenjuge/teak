import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

type PostHogIdentityCtx = {
  auth?: {
    getUserIdentity?: () => Promise<{ subject: string } | null>;
  };
};

export const identifyPostHogUser = async (
  ctx: PostHogIdentityCtx
): Promise<{ distinctId: string } | null> => {
  const identity = await ctx.auth?.getUserIdentity?.();
  if (!identity?.subject) {
    return null;
  }

  return { distinctId: identity.subject };
};

export const posthog = new PostHog(components.posthog, {
  identify: identifyPostHogUser,
});

type BackendEventCtx = {
  scheduler?: unknown;
  auth?: unknown;
  runAction?: unknown;
};

type BackendEventArgs = {
  event: string;
  distinctId?: string;
  properties?: Record<string, unknown>;
};

export const captureBackendEvent = async (
  ctx: BackendEventCtx,
  { event, distinctId, properties }: BackendEventArgs
): Promise<void> => {
  try {
    await posthog.capture(ctx as never, {
      event,
      distinctId,
      properties: {
        analytics_source: "convex_backend",
        teak_source: "convex",
        teak_version: "1.0.25",
        ...properties,
      },
    });
  } catch (error) {
    console.error("Failed to capture backend PostHog event", {
      event,
      error,
    });
  }
};
