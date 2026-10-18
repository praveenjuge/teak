import type {
  ClientEventCatalog,
  ClientEventName,
} from "@teak/convex/shared/analytics";
import { createPostHogBatch } from "@teak/convex/shared/posthog";
import { getCaptureOwner } from "./captureOwner";
import { getPostHogProjectToken } from "./env";

type RecordEvents = (
  batch: ReturnType<typeof createPostHogBatch>,
  distinctId: string | undefined
) => void;

const flush = async (token: string, record: RecordEvents): Promise<void> => {
  const batch = createPostHogBatch({
    lib: "teak-extension",
    libVersion: chrome.runtime.getManifest().version,
    platform: "web:javascript",
    token,
  });
  const owner = await getCaptureOwner().catch(() => undefined);
  record(batch, owner);
  await batch.flush();
};

const send = async (record: RecordEvents): Promise<void> => {
  const token = getPostHogProjectToken();
  if (!token) {
    return;
  }
  await flush(token, record).catch(() => undefined);
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
