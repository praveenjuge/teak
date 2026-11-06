import { internal } from "../../_generated/api";
import { noContent, type PublicApiCall } from "./operation";
import { parseFolderCardsPayload, parseFolderPayload } from "./payloads";
import { serializeFolder, serializeFolderRuleRun } from "./serializers";
import { errorResponse, json } from "./shared";

const folderIdOf = (call: PublicApiCall) => call.params.folderId;

export const handleListFoldersRequest = async ({
  ctx,
  userId,
}: PublicApiCall): Promise<Response> => {
  const folders = await ctx.runQuery(
    internal.publicApiFolders.listFoldersForApi,
    { userId }
  );
  return json(200, { items: folders.map(serializeFolder) });
};

export const handleCreateFolderRequest = async ({
  body,
  ctx,
  userId,
}: PublicApiCall): Promise<Response> => {
  const parsed = parseFolderPayload(body, "create");
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  const { autoFileEnabled, autoFileQuery, autoTags, color, kind, name, query } =
    parsed.payload;
  const folder = await ctx.runMutation(
    internal.publicApiFolders.createFolderForApi,
    {
      userId,
      name: name ?? "",
      ...(color ? { color } : {}),
      ...(kind ? { kind } : {}),
      ...(query === undefined ? {} : { query }),
      ...(autoTags === undefined ? {} : { autoTags }),
      ...(autoFileQuery === undefined ? {} : { autoFileQuery }),
      ...(autoFileEnabled === undefined ? {} : { autoFileEnabled }),
    }
  );
  return json(201, serializeFolder(folder));
};

export const handleGetFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const folder = await call.ctx.runQuery(
    internal.publicApiFolders.getFolderForApi,
    { userId: call.userId, folderId: folderIdOf(call) }
  );
  return folder
    ? json(200, serializeFolder(folder))
    : errorResponse(404, "NOT_FOUND", "Folder not found");
};

export const handleUpdateFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const parsed = parseFolderPayload(call.body, "update");
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  const folder = await call.ctx.runMutation(
    internal.publicApiFolders.updateFolderForApi,
    { userId: call.userId, folderId: folderIdOf(call), ...parsed.payload }
  );
  return json(200, serializeFolder(folder));
};

export const handleDeleteFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  await call.ctx.runMutation(internal.publicApiFolders.deleteFolderForApi, {
    userId: call.userId,
    folderId: folderIdOf(call),
  });
  return noContent();
};

const changeFolderCards =
  (action: "add" | "remove") =>
  async (call: PublicApiCall): Promise<Response> => {
    const parsed = parseFolderCardsPayload(call.body);
    if ("error" in parsed) {
      return errorResponse(400, "INVALID_INPUT", parsed.error);
    }
    const result = await call.ctx.runMutation(
      internal.publicApiFolders.changeFolderCardsForApi,
      {
        userId: call.userId,
        folderId: folderIdOf(call),
        action,
        cardIds: parsed.cardIds,
      }
    );
    return json(200, result);
  };

export const handleAddCardsToFolderRequest = changeFolderCards("add");
export const handleRemoveCardsFromFolderRequest = changeFolderCards("remove");

const ruleRunArgs = (call: PublicApiCall) => ({
  userId: call.userId,
  folderId: folderIdOf(call),
  runId: call.params.runId,
});

export const handleGetFolderRuleRunRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const run = await call.ctx.runQuery(
    internal.publicApiFolders.getFolderRuleRunForApi,
    ruleRunArgs(call)
  );
  return json(200, serializeFolderRuleRun(run));
};

export const handleUndoFolderRuleRunRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const run = await call.ctx.runMutation(
    internal.publicApiFolders.undoFolderRuleRunForApi,
    ruleRunArgs(call)
  );
  return json(200, serializeFolderRuleRun(run));
};
