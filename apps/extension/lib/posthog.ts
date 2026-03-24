import posthog from "posthog-js";

posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string,
  capture_exceptions: true,
  loaded: (ph) => {
    ph.register({
      teak_source: "extension",
      teak_version: "1.0.25",
    });
  },
});

export { default as posthog } from "posthog-js";

export const POSTHOG_USER_ID_KEY = "posthogUserId";

export async function getDistinctId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get<{ posthogUserId?: string }>(
      POSTHOG_USER_ID_KEY
    );
    return result.posthogUserId ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

export async function identifyUser(userId: string): Promise<void> {
  await chrome.storage.local.set({ [POSTHOG_USER_ID_KEY]: userId });
  posthog.identify(userId);
}
