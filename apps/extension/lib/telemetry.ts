import type {
  ClientEventCatalog,
  ClientEventName,
} from "@teak/convex/shared/analytics";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { getPostHogProjectToken } from "./env";
import { getCaptureOwner } from "./oauthAuth";

/**
 * Extension telemetry without an SDK: no remote code, nothing in the content
 * script. Each call sends one request with the shared fetch helper, owned by
 * the signed-in Teak account when there is one.
 */

const send = async (
  record: (
    batch: ReturnType<typeof createPostHogBatch>,
    distinctId: string | undefined
  ) => void
): Promise<void> => {
  const token = getPostHogProjectToken();
  if (!token) {
    return;
  }
  try {
    const batch = createPostHogBatch({
      lib: "teak-extension",
      libVersion: chrome.runtime.getManifest().version,
      platform: "web:javascript",
      token,
    });
    const owner = await getCaptureOwner().catch(() => undefined);
    record(batch, owner);
    await batch.flush();
  } catch {
    // Telemetry must never alter a save or a sign-in.
  }
};

export const captureExtensionEvent = <Name extends ClientEventName>(
  event: Name,
  properties: ClientEventCatalog[Name] | Record<string, unknown>
): Promise<void> =>
  send((batch, distinctId) =>
    batch.capture({
      distinctId,
      event,
      properties: { ...properties, surface: "extension" },
    })
  );

export const captureExtensionException = (
  error: unknown,
  properties: Record<string, unknown> = {}
): Promise<void> =>
  send((batch, distinctId) =>
    batch.captureException(error, {
      distinctId,
      handled: false,
      properties: { ...properties, surface: "extension" },
    })
  );

/** Reports uncaught errors and rejections in this extension page or worker. */
export const reportUncaughtErrors = (
  scope: EventTarget,
  context: string
): void => {
  scope.addEventListener("error", (event) => {
    const { error, message } = event as ErrorEvent;
    void captureExtensionException(error ?? message, { context });
  });
  scope.addEventListener("unhandledrejection", (event) => {
    void captureExtensionException((event as PromiseRejectionEvent).reason, {
      context,
    });
  });
};
