import { type ActionCtx, httpAction } from "../../_generated/server";
import {
  matchPublicApiOperation,
  PUBLIC_API_OPERATIONS,
  type PublicApiOperationCall,
  type PublicApiOperationId,
  type PublicApiOperationSpec,
  publicApiMethodsFor,
  publicApiPath,
} from "../../shared/publicApiContract";
import type { WorkosResource } from "../../workos/tokens";
import { withAuthorizedUser } from "./auth";
import {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardContentRequest,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleDeleteCardRequest,
  handleGetCardRequest,
  handleRefreshCardRequest,
  handleResetThumbnailRequest,
  handleRestoreCardRequest,
  handleSaveCardPdfRequest,
  handleSetFavoriteRequest,
  handleSetPinnedRequest,
  handleSetThumbnailRequest,
  handleTagsRequest,
  handleThumbnailUploadRequest,
  handleUpdateCardRequest,
  setDone,
} from "./cards";
import { handleDuplicateCardRequest } from "./duplicate";
import { handleLatestExportRequest, handleStartExportRequest } from "./exports";
import {
  handleAddCardsToFolderRequest,
  handleCreateFolderRequest,
  handleDeleteFolderRequest,
  handleGetFolderRequest,
  handleGetFolderRuleRunRequest,
  handleListFoldersRequest,
  handleRemoveCardsFromFolderRequest,
  handleUndoFolderRuleRunRequest,
  handleUpdateFolderRequest,
} from "./folders";
import {
  handleCreateHighlightRequest,
  handleDeleteHighlightRequest,
  handleListHighlightsRequest,
  handleUpdateHighlightRequest,
} from "./highlights";
import { handleMeRequest } from "./me";
import { unroutedV1Response, withPublicApiGatewayHeaders } from "./meta";
import type { PublicApiHandler } from "./operation";
import { handleCreatePageSnapshotUploadRequest } from "./pageSnapshots";
import { handlePinnedOrderRequest } from "./pins";
import { errorResponse } from "./shared";
import { handleGetTagOperationRequest, startTagOperation } from "./tags";

/** Operations with an HTTP action of their own, outside the bearer gate. */
export type StandaloneOperationId =
  | "disconnectOAuthConsent"
  | "getApiDiscovery"
  | "getHealth";
type GatedOperationId = Exclude<PublicApiOperationId, StandaloneOperationId>;

/**
 * Each bearer-gated operation's handler. The router authorizes the call and
 * parses a JSON body first, so a handler starts from a known user.
 */
const HANDLERS: Record<GatedOperationId, PublicApiHandler> = {
  getMe: handleMeRequest,
  listCards: handleCardsListRequest,
  createCard: handleCreateCardRequest,
  createUpload: handleCreateUploadRequest,
  createPageSnapshotUpload: handleCreatePageSnapshotUploadRequest,
  bulkCards: handleBulkCardsRequest,
  listCardChanges: handleCardChangesRequest,
  reorderPinnedCards: handlePinnedOrderRequest,
  findDuplicateCard: handleDuplicateCardRequest,
  getCard: handleGetCardRequest,
  updateCard: handleUpdateCardRequest,
  deleteCard: handleDeleteCardRequest,
  restoreCard: handleRestoreCardRequest,
  getCardContent: handleCardContentRequest,
  refreshCard: handleRefreshCardRequest,
  createThumbnailUpload: handleThumbnailUploadRequest,
  setCardThumbnail: handleSetThumbnailRequest,
  resetCardThumbnail: handleResetThumbnailRequest,
  markCardDone: setDone(true),
  unmarkCardDone: setDone(false),
  saveCardPdf: handleSaveCardPdfRequest,
  setCardFavorite: handleSetFavoriteRequest,
  setCardPinned: handleSetPinnedRequest,
  listTags: handleTagsRequest,
  renameTag: startTagOperation("rename"),
  mergeTags: startTagOperation("merge"),
  deleteTag: startTagOperation("delete"),
  getTagOperation: handleGetTagOperationRequest,
  listFolders: handleListFoldersRequest,
  createFolder: handleCreateFolderRequest,
  getFolder: handleGetFolderRequest,
  updateFolder: handleUpdateFolderRequest,
  deleteFolder: handleDeleteFolderRequest,
  addCardsToFolder: handleAddCardsToFolderRequest,
  removeCardsFromFolder: handleRemoveCardsFromFolderRequest,
  getFolderRuleRun: handleGetFolderRuleRunRequest,
  undoFolderRuleRun: handleUndoFolderRuleRunRequest,
  listHighlights: handleListHighlightsRequest,
  createHighlight: handleCreateHighlightRequest,
  updateHighlight: handleUpdateHighlightRequest,
  deleteHighlight: handleDeleteHighlightRequest,
  startExport: handleStartExportRequest,
  getLatestExport: handleLatestExportRequest,
};

const HANDLER_BY_OPERATION = new Map<GatedOperationId, PublicApiHandler>(
  Object.entries(HANDLERS) as [GatedOperationId, PublicApiHandler][]
);

const isGated = (id: PublicApiOperationId): id is GatedOperationId =>
  id in HANDLERS;

const readsBody = (id: PublicApiOperationId): boolean =>
  (PUBLIC_API_OPERATIONS[id] as PublicApiOperationSpec).body === true;

interface OperationRun {
  /** A body already parsed (an MCP tool's arguments); else the request's. */
  body?: { value: unknown };
  operationId: GatedOperationId;
  params: Readonly<Record<string, string>>;
  request: Request;
  resource: WorkosResource;
}

const runOperation = async (
  ctx: ActionCtx,
  run: OperationRun
): Promise<Response> => {
  const auth = await withAuthorizedUser(ctx, run.request, {
    resource: run.resource,
  });
  if ("error" in auth) {
    return auth.error;
  }
  let body = run.body?.value;
  if (!run.body && readsBody(run.operationId)) {
    try {
      body = await run.request.json();
    } catch {
      return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
    }
  }
  const handler = HANDLER_BY_OPERATION.get(run.operationId);
  if (!handler) {
    return errorResponse(404, "NOT_FOUND", "Not found");
  }
  return await handler({
    body,
    ctx,
    params: run.params,
    request: run.request,
    resource: run.resource,
    userId: auth.validated.userId,
  });
};

/** Answers a REST request under `/v1/`, or its JSON 404 or 405. */
export const handlePublicApiRequest = (
  ctx: ActionCtx,
  request: Request,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const match = matchPublicApiOperation(request.method, pathname);
  if (!(match && isGated(match.operationId))) {
    return Promise.resolve(
      unroutedV1Response(
        request.method,
        pathname,
        publicApiMethodsFor(pathname)
      )
    );
  }
  return runOperation(ctx, {
    operationId: match.operationId,
    params: match.params,
    request,
    resource,
  });
};

export const publicApiV1 = httpAction(async (ctx, request) =>
  withPublicApiGatewayHeaders(await handlePublicApiRequest(ctx, request))
);

const requestFor = (call: PublicApiOperationCall, origin: string): Request => {
  const url = new URL(publicApiPath(call.operationId, call.params), origin);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return new Request(url, {
    headers: call.headers,
    method: PUBLIC_API_OPERATIONS[call.operationId].method,
  });
};

/**
 * Runs an operation by id with its parameters and body as values: the MCP
 * server's way in. Links in the answer point at `origin`, the server the
 * client reached.
 */
export const executePublicApiOperation = (
  ctx: ActionCtx,
  call: PublicApiOperationCall,
  options: { origin: string; resource: WorkosResource }
): Promise<Response> => {
  if (!isGated(call.operationId)) {
    return Promise.resolve(errorResponse(404, "NOT_FOUND", "Route not found"));
  }
  return runOperation(ctx, {
    body: readsBody(call.operationId) ? { value: call.body } : undefined,
    operationId: call.operationId,
    params: call.params ?? {},
    request: requestFor(call, options.origin),
    resource: options.resource,
  });
};
