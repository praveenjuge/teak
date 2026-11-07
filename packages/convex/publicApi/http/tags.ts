import { internal } from "../../_generated/api";
import { parsePublicApiBody } from "../../shared/publicApiBodies";
import type { TagOperationKind } from "../../shared/tags";
import type { TagOperationSummary } from "../../tag/tagOperations";
import type { PublicApiCall } from "./operation";
import { errorResponse, json } from "./shared";

export const serializeTagOperation = (operation: TagOperationSummary) => ({
  id: operation._id,
  kind: operation.kind,
  from: operation.from,
  to: operation.to ?? null,
  status: operation.status,
  total: operation.total,
  processed: operation.processed,
  changed: operation.changed,
  error: operation.error ?? null,
  createdAt: operation.createdAt,
  updatedAt: operation.updatedAt,
  completedAt: operation.completedAt ?? null,
});

export const handleGetTagOperationRequest = async ({
  ctx,
  params,
  userId,
}: PublicApiCall): Promise<Response> => {
  const operation = await ctx.runQuery(
    internal.publicApiTags.getTagOperationForUser,
    { userId, operationId: params.operationId }
  );
  return operation
    ? json(200, serializeTagOperation(operation))
    : errorResponse(404, "NOT_FOUND", "Tag operation not found");
};

/** The tag a change starts from and the one it ends at, from its body. */
const tagChangeOf = (
  kind: TagOperationKind,
  body: unknown
): { error: string } | { from: string; to?: string } => {
  switch (kind) {
    case "rename": {
      const parsed = parsePublicApiBody("renameTag", body);
      return "error" in parsed ? parsed : parsed.body;
    }
    case "merge": {
      const parsed = parsePublicApiBody("mergeTags", body);
      return "error" in parsed
        ? parsed
        : { from: parsed.body.from, to: parsed.body.into };
    }
    case "delete": {
      const parsed = parsePublicApiBody("deleteTag", body);
      return "error" in parsed ? parsed : { from: parsed.body.tag };
    }
    default:
      return kind satisfies never;
  }
};

export const startTagOperation =
  (kind: TagOperationKind) =>
  async ({ body, ctx, userId }: PublicApiCall): Promise<Response> => {
    const change = tagChangeOf(kind, body);
    if ("error" in change) {
      return errorResponse(400, "INVALID_INPUT", change.error);
    }
    const operation = await ctx.runMutation(
      internal.publicApiTags.startTagOperationForUser,
      { userId, kind, ...change }
    );
    const serialized = serializeTagOperation(operation);
    return json(202, { operationId: serialized.id, ...serialized });
  };

/** `GET /v1/tags`; the listing's policy is in `tag/tagListing`. */
export const handleTagsRequest = async ({
  ctx,
  userId,
}: PublicApiCall): Promise<Response> => {
  const { requestSummary, ...listing } = await ctx.runQuery(
    internal.tag.tagListing.listTagsForUser,
    { userId }
  );
  if (requestSummary) {
    await ctx.runMutation(internal.tag.tagSummary.requestTagSummaryForUser, {
      userId,
    });
  }
  return json(200, listing);
};
