import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/convex/_generated/api.js";

/**
 * Waits until the backend opens a Teak vault for this WorkOS session, the way
 * the web app's first sign-in does: `workosBootstrap.ensureUser` answers `ok`
 * once WorkOS's user.created webhook has delivered the profile. Throws with the
 * bootstrap's last answer when the deadline passes. Runs under Bun and under
 * the e2e CLI's Node.
 */
export const waitForTeakAccount = async (options: {
  accessToken: string;
  convexUrl: string;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<{ client: ConvexHttpClient; teakUserId: string }> => {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 1000;
  const client = new ConvexHttpClient(options.convexUrl);
  client.setAuth(options.accessToken);
  const deadline = Date.now() + timeoutMs;
  let last: string;
  for (;;) {
    try {
      const result = await client.mutation(api.workosBootstrap.ensureUser, {});
      if (result.status === "ok") {
        return { client, teakUserId: result.teakUserId };
      }
      last =
        result.status === "quarantined"
          ? `quarantined (${result.reason})`
          : result.status;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() + intervalMs >= deadline) {
      throw new Error(
        `No Teak account after ${timeoutMs / 1000} s; the bootstrap last answered ${last}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
