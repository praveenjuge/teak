import { internal } from "../../_generated/api";
import { parsePublicApiBody } from "../../shared/publicApiBodies";
import { noContent, type PublicApiCall } from "./operation";
import { serializeFolder, serializeFolderRuleRun } from "./serializers";
import { errorResponse, json } from "./shared";

const folderIdOf = (call: PublicApiCall) => call.params.folderId;

export const handleListFoldersRequest = async ({
  ctx,
  userId,
}: PublicApiCall): Promise<Response> => {
  const folders = await ctx.runQuery(
    internal.publicApiFolders.listFoldersForUser,
    { userId }
  );
  return json(200, { items: folders.map(serializeFolder) });
};

export const handleCreateFolderRequest = async ({
  body,
  ctx,
  userId,
}: PublicApiCall): Promise<Response> => {
  const parsed = parsePublicApiBody("createFolder", body);
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  const folder = await ctx.runMutation(
    internal.publicApiFolders.createFolderForUser,
    { userId, ...parsed.body }
  );
  return json(201, serializeFolder(folder));
};

export const handleGetFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const folder = await call.ctx.runQuery(
    internal.publicApiFolders.getFolderForUser,
    { userId: call.userId, folderId: folderIdOf(call) }
  );
  return folder
    ? json(200, serializeFolder(folder))
    : errorResponse(404, "NOT_FOUND", "Folder not found");
};

export const handleUpdateFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const parsed = parsePublicApiBody("updateFolder", call.body);
  if ("error" in parsed) {
    return errorResponse(400, "INVALID_INPUT", parsed.error);
  }
  const folder = await call.ctx.runMutation(
    internal.publicApiFolders.updateFolderForUser,
    { userId: call.userId, folderId: folderIdOf(call), ...parsed.body }
  );
  return json(200, serializeFolder(folder));
};

export const handleDeleteFolderRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  await call.ctx.runMutation(internal.publicApiFolders.deleteFolderForUser, {
    userId: call.userId,
    folderId: folderIdOf(call),
  });
  return noContent();
};

const changeFolderCards =
  (action: "add" | "remove") =>
  async (call: PublicApiCall): Promise<Response> => {
    const parsed = parsePublicApiBody(
      action === "add" ? "addCardsToFolder" : "removeCardsFromFolder",
      call.body
    );
    if ("error" in parsed) {
      return errorResponse(400, "INVALID_INPUT", parsed.error);
    }
    const result = await call.ctx.runMutation(
      internal.publicApiFolders.changeFolderCardsForUser,
      {
        userId: call.userId,
        folderId: folderIdOf(call),
        action,
        cardIds: parsed.body.cardIds,
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
    internal.publicApiFolders.getFolderRuleRunForUser,
    ruleRunArgs(call)
  );
  return json(200, serializeFolderRuleRun(run));
};

export const handleUndoFolderRuleRunRequest = async (
  call: PublicApiCall
): Promise<Response> => {
  const run = await call.ctx.runMutation(
    internal.publicApiFolders.undoFolderRuleRunForUser,
    ruleRunArgs(call)
  );
  return json(200, serializeFolderRuleRun(run));
};
