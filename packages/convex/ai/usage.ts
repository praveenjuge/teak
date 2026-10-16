import { env } from "../_generated/server";

/**
 * Params for a Files op that calls Workers AI on a user's behalf: the Worker
 * records each model call in Analytics Engine charged to this deployment's
 * user, and the hourly rollup turns those into `aiUsageDaily`.
 */
export const aiUsageParams = (
  userId: string
): { aiUsage?: { convexSiteUrl: string; userId: string } } =>
  env.CONVEX_SITE_URL
    ? { aiUsage: { convexSiteUrl: env.CONVEX_SITE_URL, userId } }
    : {};
