import { internal } from "../../_generated/api";
import { PAGE_SNAPSHOT_MAX_BYTES } from "../../shared/pageArchive";
import { parsePublicApiBody } from "../../shared/publicApiBodies";
import type { PublicApiCall } from "./operation";
import { errorResponse, json } from "./shared";

/**
 * POST /v1/page-snapshots/upload: a signed URL for the page the browser
 * extension saw when it saved a link, gzipped. Pass the answer's `fileKey`
 * as `pageSnapshotKey` to POST /v1/cards.
 */
export const handleCreatePageSnapshotUploadRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const { ctx, userId } = call;
  const payload = call.body;
  const parsed = parsePublicApiBody("createPageSnapshotUpload", payload);
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  if (parsed.body.bytes > PAGE_SNAPSHOT_MAX_BYTES) {
    return errorResponse(
      413,
      "PAGE_SNAPSHOT_TOO_LARGE",
      `A page snapshot can be at most ${PAGE_SNAPSHOT_MAX_BYTES} bytes`
    );
  }
  return json(
    200,
    await ctx.runMutation(
      internal.publicApiPageSnapshots.createPageSnapshotUploadForUser,
      { bytes: parsed.body.bytes, userId }
    )
  );
};
