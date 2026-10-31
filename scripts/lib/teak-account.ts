import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/convex/_generated/api.js";

/**
 * Opens the Teak vault for this WorkOS session the way the web app's first
 * sign-in does, retrying `workosBootstrap.ensureUser` until it answers `ok`
 * (a cold backend can refuse the first calls). Throws with the bootstrap's
 * last answer when the deadline passes. Runs under Bun and under the e2e
 * CLI's Node.
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
