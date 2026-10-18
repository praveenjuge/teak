import { env } from "../_generated/server";

export const aiUsageParams = (
  userId: string
): { aiUsage?: { convexSiteUrl: string; userId: string } } =>
  env.CONVEX_SITE_URL
    ? { aiUsage: { convexSiteUrl: env.CONVEX_SITE_URL, userId } }
    : {};
