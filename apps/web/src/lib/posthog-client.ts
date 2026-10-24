import { buildPostHogOptions } from "./posthog-config";

type PostHog = typeof import("posthog-js")["default"];
type PendingCall = (posthog: PostHog) => void;

const MAX_PENDING = 100;
const IDLE_TIMEOUT_MS = 3000;

let client: PostHog | undefined;
let enabled = false;
const pending: PendingCall[] = [];

const callSafely = (posthog: PostHog, call: PendingCall): boolean => {
  try {
    call(posthog);
    return true;
  } catch {
    return false;
  }
};

export const withPostHog = (call: PendingCall): void => {
  if (client) {
    callSafely(client, call);
    return;
  }
  if (enabled && pending.length < MAX_PENDING) {
    pending.push(call);
  }
};

const whenIdle = (callback: () => void) => {
  // Older Safari versions have no requestIdleCallback.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(callback, IDLE_TIMEOUT_MS);
};

export const startPostHog = (token: string | undefined): void => {
  if (!token || enabled) {
    return;
  }
  enabled = true;

  const onError = (event: ErrorEvent) => {
    const error = event.error ?? event.message;
    withPostHog((posthog) => posthog.captureException(error));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    withPostHog((posthog) => posthog.captureException(reason));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  whenIdle(() => {
    import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(token, buildPostHogOptions());
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        client = posthog;
        for (const call of pending.splice(0)) {
          withPostHog(call);
        }
      })
      .catch(() => {
        enabled = false;
        pending.length = 0;
      });
  });
};

const IDENTITY_KEY = "teak_posthog_identity";

const readSentIdentity = (): string | null => {
  try {
    return localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
};

export const identifyPostHogUser = (
  userId: string,
  email: string | undefined
): void =>
  withPostHog((posthog) => {
    const identity = `${userId}|${email ?? ""}`;
    const sameUser = posthog.get_distinct_id() === userId;
    if (sameUser && readSentIdentity() === identity) {
      return;
    }
    posthog.identify(userId, email ? { email } : undefined);
    if (!sameUser) {
      posthog.capture("signed_in");
    }
    localStorage.setItem(IDENTITY_KEY, identity);
  });

/** Person properties that describe the account, such as its UI language. */
export const setPostHogPersonProperties = (
  properties: Record<string, string>
): void =>
  withPostHog((posthog) => {
    posthog.setPersonProperties(properties);
  });

export const resetPostHogUser = (): void =>
  withPostHog((posthog) => {
    posthog.reset();
    localStorage.removeItem(IDENTITY_KEY);
  });
