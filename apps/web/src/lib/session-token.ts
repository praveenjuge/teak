const MAX_RETRY_DELAY_MS = 30_000;
// AuthKit reports a refused session and a passing server-side failure the
// same way, so a refusal only counts once it repeats.
const REFUSALS_BEFORE_SIGN_OUT = 3;

// Convex reads a null token as "signed out" and never asks again, so null
// must mean the session is really gone. A request that never reached the
// server (a dropped connection, a laptop waking up) says nothing about the
// session, so wait for the network and try again instead.
export async function fetchSessionToken(
  load: () => Promise<string | undefined>
): Promise<string | null> {
  let refusals = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return (await load()) ?? null;
    } catch (error) {
      // fetch rejects with a TypeError only when no response came back. Any
      // other error means the server answered and the refresh failed.
      if (!(error instanceof TypeError)) {
        refusals += 1;
        if (refusals >= REFUSALS_BEFORE_SIGN_OUT) {
          return null;
        }
      }
    }
    await waitToRetry(attempt);
  }
}

const waitToRetry = (attempt: number) =>
  new Promise<void>((resolve) => {
    const retry = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("online", retry);
      resolve();
    };
    const timeout = window.setTimeout(
      retry,
      Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS)
    );
    window.addEventListener("online", retry);
  });
