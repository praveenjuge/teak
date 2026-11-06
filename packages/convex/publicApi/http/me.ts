import { internal } from "../../_generated/api";
import type { PublicApiCall } from "./operation";
import { getAppBaseUrl } from "./serializers";
import { errorResponse, json } from "./shared";

export const handleMeRequest = async ({
  ctx,
  request,
  userId,
}: PublicApiCall): Promise<Response> => {
  try {
    const profile = await ctx.runQuery(internal.publicApiMe.profileForUser, {
      teakUserId: userId,
      includeUsage: true,
    });
    const settingsUrl = new URL("/settings", getAppBaseUrl(request.url));
    return profile
      ? json(200, { data: { ...profile, settingsUrl: settingsUrl.toString() } })
      : errorResponse(401, "UNAUTHORIZED", "User profile unavailable");
  } catch (error) {
    console.error("[publicApi] user profile unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(500, "INTERNAL_ERROR", "Failed to load user profile");
  }
};
