import { internal } from "../../_generated/api";
import {
  explainInvalidTagName,
  explainInvalidTagSource,
  type TagOperationKind,
} from "../../shared/tags";
import type { TagOperationSummary } from "../../tag/tagOperations";
import type { PublicApiCall } from "./operation";
import { errorResponse, json, mapConvexErrorToResponse } from "./shared";

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
  try {
    const operation = await ctx.runQuery(
      internal.publicApiTags.getTagOperationForApi,
      { userId, operationId: params.operationId }
    );
    return operation
      ? json(200, serializeTagOperation(operation))
      : errorResponse(404, "NOT_FOUND", "Tag operation not found");
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to fetch tag operation");
  }
};

export const startTagOperation =
  (kind: TagOperationKind) =>
  async ({ body, ctx, userId }: PublicApiCall): Promise<Response> => {
    const start = startFields(kind);
    const parsed = parseTagOperationPayload(body, start);
    if ("error" in parsed) {
      return errorResponse(400, "INVALID_INPUT", parsed.error);
    }
    try {
      const operation = await ctx.runMutation(
        internal.publicApiTags.startTagOperationForApi,
        { userId, kind, ...parsed }
      );
      const serialized = serializeTagOperation(operation);
      return json(202, { operationId: serialized.id, ...serialized });
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to start tag change");
    }
  };
