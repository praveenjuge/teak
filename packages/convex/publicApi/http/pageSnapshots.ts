import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { PAGE_SNAPSHOT_MAX_BYTES } from "../../shared/pageArchive";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./shared";

export const parsePageSnapshotUploadPayload = (
  payload: unknown
): { bytes: number } | { error: string } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }
  const source = payload as Record<string, unknown>;
  const unknownKey = Object.keys(source).find((key) => key !== "bytes");
  if (unknownKey !== undefined) {
    return { error: `Unknown field \`${unknownKey}\`` };
  }
  const { bytes } = source;
  if (
    !(typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0)
  ) {
    return { error: "`bytes` must be a positive whole number" };
  }
  return { bytes };
};

/**
 * POST /v1/page-snapshots/upload: a signed URL for the page the browser
 * extension saw when it saved a link, gzipped. Pass the answer's `fileKey`
 * as `pageSnapshotKey` to POST /v1/cards.
 */
export const handleCreatePageSnapshotUploadRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const parsed = parsePageSnapshotUploadPayload(payload);
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  if (parsed.bytes > PAGE_SNAPSHOT_MAX_BYTES) {
    return errorResponse(
      413,
      "PAGE_SNAPSHOT_TOO_LARGE",
      `A page snapshot can be at most ${PAGE_SNAPSHOT_MAX_BYTES} bytes`
    );
  }
  try {
    return json(
      200,
      await ctx.runMutation(
        internal.publicApiPageSnapshots.createPageSnapshotUploadForUser,
        { bytes: parsed.bytes, userId: auth.validated.userId }
      )
    );
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to prepare the upload");
  }
};
