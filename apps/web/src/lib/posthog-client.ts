import { buildPostHogOptions } from "./posthog-config";

/**
 * Loads posthog-js only after the page is idle, so it never joins the initial
 * bundle or competes with first paint. Calls made before it loads wait in a
 * small queue, and early page errors are kept until the SDK takes over.
 */

type PostHog = typeof import("posthog-js")["default"];
type PendingCall = (posthog: PostHog) => void;

const MAX_PENDING = 100;
const IDLE_TIMEOUT_MS = 3000;

let client: PostHog | undefined;
let enabled = false;
const pending: PendingCall[] = [];

/** Runs `call` now if PostHog is loaded, or once it loads. */
export const withPostHog = (call: PendingCall): void => {
  if (client) {
    try {
      call(client);
    } catch {
      // Analytics must never alter product behavior.
    }
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

  // Errors thrown before the SDK loads; its own capture handles later ones.
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
        // A blocked or failed download leaves analytics off for this page.
        enabled = false;
        pending.length = 0;
      });
  });
};

// The last identity sent from this browser, so page loads don't resend it.
const IDENTITY_KEY = "teak_posthog_identity";

const readSentIdentity = (): string | null => {
  try {
    return localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
};

/** Links this browser to the signed-in Teak account. */
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
    try {
      localStorage.setItem(IDENTITY_KEY, identity);
    } catch {
      // Without storage the identity is simply sent again next load.
    }
  });

/** Starts a fresh anonymous identity after sign-out. */
export const resetPostHogUser = (): void =>
  withPostHog((posthog) => {
    posthog.reset();
    try {
      localStorage.removeItem(IDENTITY_KEY);
    } catch {
      // Nothing to clear.
    }
  });
