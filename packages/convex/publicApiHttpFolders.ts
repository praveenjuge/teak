/**
 * Public API folder endpoints: /v1/folders and /v1/folders/:id[/cards].
 */
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { withAuthorizedUser } from "./publicApiHttpAuth";
import {
  errorResponse,
  json,
  mapConvexErrorToResponse,
  parseJsonBody,
} from "./publicApiHttpShared";
import {
  parseFolderCardsPayload,
  parseFolderPayload,
  parseFolderRoute,
  serializeFolder,
} from "./publicApiHttpValidation";
import type { WorkosResource } from "./workosTokens";

const readJson = async (
  request: Request
): Promise<{ payload: unknown } | { error: Response }> => {
  try {
    return { payload: await parseJsonBody(request) };
  } catch {
    return { error: errorResponse(400, "BAD_REQUEST", "Invalid JSON body") };
  }
};

/** GET /v1/folders lists folders by name; POST creates one. */
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
      }
    );
    return json(201, serializeFolder(folder));
  } catch (error) {
    return mapConvexErrorToResponse(error, "Failed to create folder");
  }
};

/**
 * GET, PATCH and DELETE /v1/folders/:id, and POST or DELETE
 * /v1/folders/:id/cards with `{ cardIds }` to add or remove cards (409
 * SMART_FOLDER for a smart folder).
 */
export const handleFolderByIdRequest = async (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const route = parseFolderRoute(request);
  if (!route) {
    return errorResponse(404, "NOT_FOUND", "Folder route not found");
  }
  const allowed = route.cards ? ["POST", "DELETE"] : ["GET", "PATCH", "DELETE"];
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
    if (route.cards) {
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
