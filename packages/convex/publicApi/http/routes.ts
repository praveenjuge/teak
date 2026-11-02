import { type ActionCtx, httpAction } from "../../_generated/server";
import { handleMeRequest } from "../../publicApiMe";
import type { WorkosResource } from "../../workos/tokens";
import {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardsByIdV1Request,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleTagsRequest,
} from "./cards";
import { handleDuplicateCardRequest } from "./duplicate";
import { handleLatestExportRequest, handleStartExportRequest } from "./exports";
import { handleFolderByIdRequest, handleFoldersRequest } from "./folders";
import {
  handleCardHighlightsRequest,
  handleHighlightRequest,
  isCardHighlightsPath,
  isHighlightPath,
} from "./highlights";
import { withPublicApiGatewayHeaders } from "./meta";
import { handleCreatePageSnapshotUploadRequest } from "./pageSnapshots";
import { handlePinnedOrderRequest } from "./pins";
import { errorResponse, type PublicApiOperation } from "./shared";
import { handleTagOperationRequest, isTagOperationPath } from "./tags";

export {
  validatePublicApiBearer,
  withAuthorizedUser,
} from "./auth";
export {
  handleCardsByIdV1Request,
  handleCreateCardRequest,
} from "./cards";
export type { PublicApiOperation } from "./shared";

const toPublicApiRequest = (operation: PublicApiOperation): Request => {
  const normalizedPath = operation.path.startsWith("/")
    ? operation.path
    : `/${operation.path}`;
  const url = new URL(
    normalizedPath,
    operation.origin ?? "https://teakvault.com"
  );

  for (const [key, value] of Object.entries(operation.query ?? {})) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry);
      }
    } else if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers(operation.headers);
  let body: string | undefined;
  if (operation.body !== undefined) {
    body = JSON.stringify(operation.body);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  return new Request(url, {
    body,
    headers,
    method: operation.method,
  });
};

export const executePublicApiOperation = (
  ctx: ActionCtx,
  operation: PublicApiOperation,
  resource: WorkosResource = "api"
): Promise<Response> => {
  const request = toPublicApiRequest(operation);
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/v1/me") {
    return handleMeRequest(ctx, request, resource);
  }
  if (request.method === "GET" && pathname === "/v1/cards") {
    return handleCardsListRequest(ctx, request, resource);
  }
  if (request.method === "POST" && pathname === "/v1/cards") {
    return handleCreateCardRequest(ctx, request, resource);
  }
  if (request.method === "POST" && pathname === "/v1/uploads") {
    return handleCreateUploadRequest(ctx, request, resource);
  }
  if (request.method === "POST" && pathname === "/v1/page-snapshots/upload") {
    return handleCreatePageSnapshotUploadRequest(ctx, request, resource);
  }
  if (request.method === "POST" && pathname === "/v1/cards/bulk") {
    return handleBulkCardsRequest(ctx, request, resource);
  }
  if (request.method === "GET" && pathname === "/v1/cards/changes") {
    return handleCardChangesRequest(ctx, request, resource);
  }
  // Before the `/v1/cards/{cardId}` routes, so `pinned` is never read as
  // a card id.
  if (request.method === "PUT" && pathname === PINNED_ORDER_PATH) {
    return handlePinnedOrderRequest(ctx, request, resource);
  }
  if (request.method === "GET" && pathname === "/v1/tags") {
    return handleTagsRequest(ctx, request, resource);
  }
  if (isTagOperationPath(pathname)) {
    return handleTagOperationRequest(ctx, request, resource);
  }
  if (pathname === "/v1/folders") {
    return handleFoldersRequest(ctx, request, resource);
  }
  if (pathname.startsWith("/v1/folders/")) {
    return handleFolderByIdRequest(ctx, request, resource);
  }
  if (request.method === "GET" && pathname === "/v1/cards/duplicate") {
    return handleDuplicateCardRequest(ctx, request, resource);
  }
  if (request.method === "GET" && pathname === "/v1/exports/latest") {
    return handleLatestExportRequest(ctx, request, resource);
  }
  if (request.method === "POST" && pathname === "/v1/exports") {
    return handleStartExportRequest(ctx, request, resource);
  }
  if (isCardHighlightsPath(pathname)) {
    return handleCardHighlightsRequest(ctx, request, resource);
  }
  if (isHighlightPath(pathname)) {
    return handleHighlightRequest(ctx, request, resource);
  }
  if (
    pathname.startsWith("/v1/cards/") &&
    (request.method === "DELETE" ||
      request.method === "GET" ||
      request.method === "PATCH" ||
      request.method === "PUT" ||
      (request.method === "POST" &&
        /^\/v1\/cards\/[^/]+\/(?:restore|refresh|done|save-pdf|thumbnail\/upload)$/.test(
          pathname
        )))
  ) {
    return handleCardsByIdV1Request(ctx, request, resource);
  }

  return Promise.resolve(errorResponse(404, "NOT_FOUND", "Route not found"));
};

const withGatewayHeaders = (
  handler: (ctx: ActionCtx, request: Request) => Promise<Response>
) =>
  httpAction(async (ctx, request) =>
    withPublicApiGatewayHeaders(await handler(ctx, request))
  );

export const createCardV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCreateCardRequest(ctx, request);
});

export const createUploadV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCreateUploadRequest(ctx, request);
});

export const pageSnapshotUploadV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCreatePageSnapshotUploadRequest(ctx, request);
});

export const listCardsV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsListRequest(ctx, request);
});

export const cardByIdV1 = withGatewayHeaders((ctx, request) => {
  if (
    !(
      request.method === "DELETE" ||
      request.method === "GET" ||
      request.method === "PATCH" ||
      request.method === "POST" ||
      request.method === "PUT"
    )
  ) {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  if (isCardHighlightsPath(new URL(request.url).pathname)) {
    return handleCardHighlightsRequest(ctx, request);
  }
  return handleCardsByIdV1Request(ctx, request);
});

export const highlightByIdV1 = withGatewayHeaders((ctx, request) =>
  handleHighlightRequest(ctx, request)
);

export const bulkCardsV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleBulkCardsRequest(ctx, request);
});

export const PINNED_ORDER_PATH = "/v1/cards/pinned/order";

export const pinnedOrderV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "PUT") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handlePinnedOrderRequest(ctx, request);
});

export const changesCardsV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardChangesRequest(ctx, request);
});

export const tagsV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "GET") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleTagsRequest(ctx, request);
});

export const foldersV1 = withGatewayHeaders((ctx, request) =>
  handleFoldersRequest(ctx, request)
);

export const folderByIdV1 = withGatewayHeaders((ctx, request) =>
  handleFolderByIdRequest(ctx, request)
);

export const tagOperationsV1 = withGatewayHeaders((ctx, request) =>
  handleTagOperationRequest(ctx, request)
);
