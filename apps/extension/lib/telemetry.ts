import type {
  ClientEventCatalog,
  ClientEventName,
} from "@teak/convex/shared/analytics";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { getCaptureOwner } from "./captureOwner";
import { getPostHogProjectToken } from "./env";

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
  } catch {}
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
