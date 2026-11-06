import { internal } from "../../_generated/api";
import {
  explainInvalidTagName,
  explainInvalidTagSource,
  type TagOperationKind,
} from "../../shared/tags";
import type { TagOperationSummary } from "../../tag/tagOperations";
import type { PublicApiCall } from "./operation";
import { errorResponse, json } from "./shared";

interface TagOperationFields {
  fromField: string;
  kind: TagOperationKind;
  toField?: string;
}

const startFields = (kind: TagOperationKind): TagOperationFields => {
  switch (kind) {
    case "rename":
      return { kind: "rename", fromField: "from", toField: "to" };
    case "merge":
      return { kind: "merge", fromField: "from", toField: "into" };
    case "delete":
      return { kind: "delete", fromField: "tag" };
    default:
      return kind satisfies never;
  }
};

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

type StartPayload = { from: string; to?: string } | { error: string };

export const parseTagOperationPayload = (
  payload: unknown,
  route: { fromField: string; toField?: string }
): StartPayload => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object" };
  }
  const source = payload as Record<string, unknown>;
  const fields = route.toField
    ? [route.fromField, route.toField]
    : [route.fromField];
  const listed = fields.map((field) => `\`${field}\``).join(" and ");
  for (const key of Object.keys(source)) {
    if (!fields.includes(key)) {
      return { error: `Body may include only ${listed}` };
    }
  }
  const values: string[] = [];
  for (const field of fields) {
    const value = source[field];
    if (typeof value !== "string") {
      return { error: `Body must include \`${field}\` as a string` };
    }
    // The tag being changed may be an older one longer than today's limit.
    const reason =
      field === route.fromField
        ? explainInvalidTagSource(value)
        : explainInvalidTagName(value);
    if (reason) {
      return { error: `\`${field}\`: ${reason}` };
    }
    values.push(value);
  }
  return { from: values[0] ?? "", ...(values[1] ? { to: values[1] } : {}) };
};

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

export const startTagOperation =
  (kind: TagOperationKind) =>
  async ({ body, ctx, userId }: PublicApiCall): Promise<Response> => {
    const start = startFields(kind);
    const parsed = parseTagOperationPayload(body, start);
    if ("error" in parsed) {
      return errorResponse(400, "INVALID_INPUT", parsed.error);
    }
    const operation = await ctx.runMutation(
      internal.publicApiTags.startTagOperationForUser,
      { userId, kind, ...parsed }
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
