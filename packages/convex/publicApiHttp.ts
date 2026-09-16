/**
 * Public API HTTP router: route dispatch plus the registered /v1 httpActions.
 * Endpoint implementations live in `publicApiHttpCards.ts`, auth in
 * `publicApiHttpAuth.ts`, validation/serialization in
 * `publicApiHttpValidation.ts`, and shared primitives in
 * `publicApiHttpShared.ts`.
 */
import { type ActionCtx, httpAction } from "./_generated/server";
import {
  handleBulkCardsRequest,
  handleCardChangesRequest,
  handleCardsByIdV1Request,
  handleCardsListRequest,
  handleCreateCardRequest,
  handleCreateUploadRequest,
  handleTagsRequest,
} from "./publicApiHttpCards";
import {
  errorResponse,
  type PublicApiOperation,
} from "./publicApiHttpShared";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";

export {
  handleCardsByIdV1Request,
  handleCreateCardRequest,
} from "./publicApiHttpCards";
export {
  validatePublicApiBearer,
  withAuthorizedUser,
} from "./publicApiHttpAuth";
export type { PublicApiOperation } from "./publicApiHttpShared";

const toPublicApiRequest = (operation: PublicApiOperation): Request => {
  const normalizedPath = operation.path.startsWith("/")
    ? operation.path
    : `/${operation.path}`;
  const url = new URL(
    normalizedPath,
    operation.origin ?? "https://teakvault.com"
  );

  for (const [key, value] of Object.entries(operation.query ?? {})) {
    if (value !== undefined) {
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
  operation: PublicApiOperation
): Promise<Response> => {
  const request = toPublicApiRequest(operation);
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/v1/cards") {
    return handleCardsListRequest(ctx, request);
  }
  if (request.method === "POST" && pathname === "/v1/cards") {
    return handleCreateCardRequest(ctx, request);
  }
  if (request.method === "POST" && pathname === "/v1/uploads") {
    return handleCreateUploadRequest(ctx, request);
  }
  if (request.method === "POST" && pathname === "/v1/cards/bulk") {
    return handleBulkCardsRequest(ctx, request);
  }
  if (request.method === "GET" && pathname === "/v1/cards/changes") {
    return handleCardChangesRequest(ctx, request);
  }
  if (request.method === "GET" && pathname === "/v1/tags") {
    return handleTagsRequest(ctx, request);
  }
  if (
    pathname.startsWith("/v1/cards/") &&
    (request.method === "DELETE" ||
      request.method === "GET" ||
      request.method === "PATCH")
  ) {
    return handleCardsByIdV1Request(ctx, request);
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
      request.method === "PATCH"
    )
  ) {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleCardsByIdV1Request(ctx, request);
});

export const bulkCardsV1 = withGatewayHeaders((ctx, request) => {
  if (request.method !== "POST") {
    return Promise.resolve(
      errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    );
  }

  return handleBulkCardsRequest(ctx, request);
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
