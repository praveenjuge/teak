import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import {
  explainInvalidTagName,
  explainInvalidTagSource,
  type TagOperationKind,
} from "../../shared/tags";
import type { TagOperationSummary } from "../../tag/tagOperations";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./shared";

const OPERATION_PREFIX = "/v1/tags/operations/";

const START_ROUTES: Record<
  string,
  { kind: TagOperationKind; fromField: string; toField?: string }
> = {
  "/v1/tags/rename": { kind: "rename", fromField: "from", toField: "to" },
  "/v1/tags/merge": { kind: "merge", fromField: "from", toField: "into" },
  "/v1/tags/delete": { kind: "delete", fromField: "tag" },
};

export const isTagOperationPath = (pathname: string): boolean =>
  pathname in START_ROUTES || pathname.startsWith(OPERATION_PREFIX);

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

export const handleTagOperationRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const start = START_ROUTES[pathname];
  let operationId: string | undefined;
  if (!start) {
    try {
      operationId = decodeURIComponent(pathname.slice(OPERATION_PREFIX.length));
    } catch {
      return errorResponse(404, "NOT_FOUND", "Tag route not found");
    }
    if (
      !(pathname.startsWith(OPERATION_PREFIX) && operationId) ||
      operationId.includes("/")
    ) {
      return errorResponse(404, "NOT_FOUND", "Tag route not found");
    }
  }
  const method = start ? "POST" : "GET";
  if (request.method !== method) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;

  if (!start) {
    try {
      const operation = await ctx.runQuery(
        internal.publicApiTags.getTagOperationForApi,
        { userId, operationId: operationId ?? "" }
      );
      return operation
        ? json(200, serializeTagOperation(operation))
        : errorResponse(404, "NOT_FOUND", "Tag operation not found");
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to fetch tag operation");
    }
  }

  let payload: unknown;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }
  const parsed = parseTagOperationPayload(payload, start);
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  try {
    const operation = await ctx.runMutation(
      internal.publicApiTags.startTagOperationForApi,
      { userId, kind: start.kind, ...parsed }
    );
    const body = serializeTagOperation(operation);
    return json(202, { operationId: body.id, ...body });
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to start tag change");
  }
};
