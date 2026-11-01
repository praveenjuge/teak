import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import { parseFolderCardsPayload, parseFolderPayload } from "./payloads";
import { parseFolderRoute } from "./routeParsing";
import { serializeFolder, serializeFolderRuleRun } from "./serializers";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./shared";

const readJson = async (
  request: Request
): Promise<{ payload: unknown } | { error: Response }> => {
  try {
    return { payload: await parseJsonBody(request) };
  } catch {
    return { error: errorResponse(400, "BAD_REQUEST", "Invalid JSON body") };
  }
};

export const handleFoldersRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  if (request.method !== "GET" && request.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;

  if (request.method === "GET") {
    try {
      const folders = await ctx.runQuery(
        internal.publicApiFolders.listFoldersForApi,
        { userId }
      );
      return json(200, { items: folders.map(serializeFolder) });
    } catch (error) {
      return mapConvexErrorToResponse(error, "Failed to list folders");
    }
  }

  const body = await readJson(request);
  if ("error" in body) {
    return body.error;
  }
  const parsed = parseFolderPayload(body.payload, "create");
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  try {
    const folder = await ctx.runMutation(
      internal.publicApiFolders.createFolderForApi,
      {
        userId,
        name: parsed.payload.name ?? "",
        ...(parsed.payload.color ? { color: parsed.payload.color } : {}),
        ...(parsed.payload.kind ? { kind: parsed.payload.kind } : {}),
        ...(parsed.payload.query === undefined
          ? {}
          : { query: parsed.payload.query }),
        ...(parsed.payload.autoTags === undefined
          ? {}
          : { autoTags: parsed.payload.autoTags }),
        ...(parsed.payload.autoFileQuery === undefined
          ? {}
          : { autoFileQuery: parsed.payload.autoFileQuery }),
        ...(parsed.payload.autoFileEnabled === undefined
          ? {}
          : { autoFileEnabled: parsed.payload.autoFileEnabled }),
      }
    );
    return json(201, serializeFolder(folder));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to create folder");
  }
};

export const handleFolderByIdRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const route = parseFolderRoute(request);
  if (!route) {
    return errorResponse(404, "NOT_FOUND", "Folder route not found");
  }
  const allowed = {
    folder: ["GET", "PATCH", "DELETE"],
    cards: ["POST", "DELETE"],
    ruleRun: ["GET"],
    undoRuleRun: ["POST"],
  }[route.kind];
  if (!allowed.includes(request.method)) {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  const auth = await withAuthorizedUser(ctx, request, { resource });
  if ("error" in auth) {
    return auth.error;
  }
  const userId = auth.validated.userId;
  const { folderId } = route;

  try {
    if (route.kind === "ruleRun" || route.kind === "undoRuleRun") {
      const args = { userId, folderId, runId: route.runId };
      const run =
        route.kind === "ruleRun"
          ? await ctx.runQuery(
              internal.publicApiFolders.getFolderRuleRunForApi,
              args
            )
          : await ctx.runMutation(
              internal.publicApiFolders.undoFolderRuleRunForApi,
              args
            );
      return json(200, serializeFolderRuleRun(run));
    }

    if (route.kind === "cards") {
      const body = await readJson(request);
      if ("error" in body) {
        return body.error;
      }
      const parsed = parseFolderCardsPayload(body.payload);
      if ("error" in parsed) {
        return errorResponse(400, "INVALID_INPUT", parsed.error);
      }
      const result = await ctx.runMutation(
        internal.publicApiFolders.changeFolderCardsForApi,
        {
          userId,
          folderId,
          action: request.method === "POST" ? "add" : "remove",
          cardIds: parsed.cardIds,
        }
      );
      return json(200, result);
    }

    if (request.method === "GET") {
      const folder = await ctx.runQuery(
        internal.publicApiFolders.getFolderForApi,
        { userId, folderId }
      );
      return folder
        ? json(200, serializeFolder(folder))
        : errorResponse(404, "NOT_FOUND", "Folder not found");
    }

    if (request.method === "DELETE") {
      await ctx.runMutation(internal.publicApiFolders.deleteFolderForApi, {
        userId,
        folderId,
      });
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const body = await readJson(request);
    if ("error" in body) {
      return body.error;
    }
    const parsed = parseFolderPayload(body.payload, "update");
    if ("error" in parsed) {
      return errorResponse(400, "INVALID_INPUT", parsed.error);
    }
    const folder = await ctx.runMutation(
      internal.publicApiFolders.updateFolderForApi,
      { userId, folderId, ...parsed.payload }
    );
    return json(200, serializeFolder(folder));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to update folder");
  }
};
