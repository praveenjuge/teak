import { env, httpAction } from "./_generated/server";
import { resolveTeakDevApiUrl } from "./devUrls";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";
import { MAX_CARD_TITLE_LENGTH } from "./shared/cardTitle";

const CARD_TYPES = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;
const CARD_SORTS = ["newest", "oldest"] as const;
const apiKeySecurity = [{ bearerAuth: [] }];

const cardProperties = {
  aiSummary: { type: ["string", "null"] },
  aiTags: { items: { type: "string" }, type: "array" },
  aiTranscript: { type: ["string", "null"] },
  appUrl: { format: "uri", type: "string" },
  compactUrl: {
    description:
      "256px rendition URL for small cards; present for image uploads.",
    type: ["string", "null"],
  },
  content: { type: "string" },
  isDeleted: { type: "boolean" },
  linkPreviewDescription: { type: ["string", "null"] },
  linkFacts: {
    type: "array",
    items: {
      type: "object",
      properties: { label: { type: "string" }, value: { type: "string" } },
      required: ["label", "value"],
    },
  },
  linkPreviewTitle: { type: ["string", "null"] },
  linkFaviconUrl: { type: ["string", "null"] },
  fileWidth: { type: ["number", "null"] },
  fileHeight: { type: ["number", "null"] },
  colors: {
    items: {
      properties: { hex: { type: "string" }, name: { type: "string" } },
      required: ["hex"],
      type: "object",
    },
    type: "array",
  },
  createdAt: { type: "number" },
  detailUrl: { type: ["string", "null"] },
  fileExtension: { type: ["string", "null"] },
  fileKind: { type: ["string", "null"] },
  fileLanguage: { type: ["string", "null"] },
  fileName: { type: ["string", "null"] },
  filePreview: {
    additionalProperties: true,
    type: ["object", "null"],
  },
  fileSize: { type: ["number", "null"] },
  fileUrl: { type: ["string", "null"] },
  id: { type: "string" },
  isFavorited: { type: "boolean" },
  linkPreviewImageUrl: { type: ["string", "null"] },
  linkPreviewMedia: {
    items: {
      properties: {
        type: { enum: ["image", "video"], type: "string" },
        url: { type: "string" },
        contentType: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        posterUrl: { type: "string" },
        posterContentType: { type: "string" },
        posterWidth: { type: "number" },
        posterHeight: { type: "number" },
      },
      required: ["type", "url"],
      type: "object",
    },
    type: "array",
  },
  linkSiteName: { type: ["string", "null"] },
  linkAuthor: { type: ["string", "null"] },
  linkPublisher: { type: ["string", "null"] },
  linkPublishedAt: { type: ["string", "null"] },
  metadataDescription: { type: ["string", "null"] },
  metadataTitle: { type: ["string", "null"] },
  mimeType: { type: ["string", "null"] },
  notes: { type: ["string", "null"] },
  placeholderUrl: {
    description:
      "48px loading-placeholder rendition URL; present for image uploads.",
    type: ["string", "null"],
  },
  screenshotUrl: { type: ["string", "null"] },
  tags: { items: { type: "string" }, type: "array" },
  thumbnailUrl: { type: ["string", "null"] },
  type: { type: "string" },
  updatedAt: { type: "number" },
  url: { type: ["string", "null"] },
} as const;

const components = {
  schemas: {
    ApiError: {
      properties: {
        code: { type: "string" },
        details: { additionalProperties: true, type: ["object", "null"] },
        error: { type: "string" },
        requestId: { type: ["string", "null"] },
        retryAt: { type: ["number", "null"] },
      },
      required: ["code", "error"],
      type: "object",
    },
    Card: {
      properties: cardProperties,
      required: [
        "aiTags",
        "appUrl",
        "compactUrl",
        "content",
        "createdAt",
        "id",
        "isFavorited",
        "placeholderUrl",
        "tags",
        "type",
        "updatedAt",
      ],
      type: "object",
    },
    CardListItem: {
      properties: {
        aiSummary: { type: ["string", "null"] },
        aiTags: { items: { type: "string" }, type: "array" },
        aiTranscript: cardProperties.aiTranscript,
        appUrl: { format: "uri", type: "string" },
        compactUrl: {
          description:
            "256px rendition URL for small cards; present for image uploads.",
          type: ["string", "null"],
        },
        content: { type: "string" },
        colors: cardProperties.colors,
        createdAt: { type: "number" },
        detailUrl: { type: ["string", "null"] },
        fileName: { type: ["string", "null"] },
        fileSize: { type: ["number", "null"] },
        mimeType: { type: ["string", "null"] },
        fileExtension: { type: ["string", "null"] },
        fileKind: { type: ["string", "null"] },
        fileLanguage: { type: ["string", "null"] },
        filePreview: {
          additionalProperties: true,
          type: ["object", "null"],
        },
        fileHeight: cardProperties.fileHeight,
        fileWidth: cardProperties.fileWidth,
        fileUrl: { type: ["string", "null"] },
        id: { type: "string" },
        isDeleted: cardProperties.isDeleted,
        isFavorited: { type: "boolean" },
        linkPreviewImageUrl: { type: ["string", "null"] },
        linkPreviewDescription: cardProperties.linkPreviewDescription,
        linkFacts: cardProperties.linkFacts,
        linkFaviconUrl: cardProperties.linkFaviconUrl,
        linkPreviewTitle: cardProperties.linkPreviewTitle,
        linkPreviewMedia: cardProperties.linkPreviewMedia,
        linkSiteName: cardProperties.linkSiteName,
        linkAuthor: cardProperties.linkAuthor,
        linkPublisher: cardProperties.linkPublisher,
        linkPublishedAt: cardProperties.linkPublishedAt,
        metadataDescription: { type: ["string", "null"] },
        metadataTitle: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
        placeholderUrl: {
          description:
            "48px loading-placeholder rendition URL; present for image uploads.",
          type: ["string", "null"],
        },
        metadataStatus: { type: ["string", "null"] },
        processingStatus: { type: ["string", "null"] },
        screenshotUrl: { type: ["string", "null"] },
        tags: { items: { type: "string" }, type: "array" },
        thumbnailUrl: { type: ["string", "null"] },
        type: { type: "string" },
        updatedAt: { type: "number" },
        url: { type: ["string", "null"] },
      },
      required: [
        "aiTags",
        "appUrl",
        "createdAt",
        "id",
        "isFavorited",
        "tags",
        "type",
        "updatedAt",
      ],
      type: "object",
    },
    CardPageInfo: {
      properties: {
        hasMore: { type: "boolean" },
        nextCursor: { type: ["string", "null"] },
      },
      required: ["hasMore", "nextCursor"],
      type: "object",
    },
    CreateCardRequest: {
      properties: {
        cardType: {
          description:
            "Optional explicit card type. Text content is stored as raw Markdown without normalization. When omitted, Teak keeps automatic URL, quote, and palette classification. Uploaded file types are inferred from fileName and mimeType.",
          enum: CARD_TYPES,
          type: "string",
        },
        content: {
          description:
            "Card content. For text cards this is canonical raw Markdown, preserved exactly, with a maximum of 512 KiB measured in UTF-8 bytes.",
          example: "  # Draft\r\n\r\n- [ ] Keep spacing  \n",
          type: "string",
        },
        fileEtag: {
          description:
            "ETag returned by the completed upload PUT. Include it when creating an uploaded-file card so Teak can verify the exact stored object.",
          example: '"d41d8cd98f00b204e9800998ecf8427e"',
          type: "string",
        },
        fileKey: { type: "string" },
        fileName: { type: "string" },
        fileSize: { type: "number" },
        mimeType: { type: "string" },
        notes: { type: ["string", "null"] },
        source: { type: "string" },
        tags: { items: { type: "string" }, type: "array" },
        url: { type: "string" },
      },
      type: "object",
    },
    CreateCardResponse: {
      properties: {
        appUrl: { format: "uri", type: "string" },
        card: { $ref: "#/components/schemas/Card" },
        cardId: { type: "string" },
        status: { enum: ["created"], type: "string" },
      },
      required: ["appUrl", "cardId", "status"],
      type: "object",
    },
    CreateUploadRequest: {
      properties: {
        fileName: { type: "string" },
        fileSize: { type: "number" },
        mimeType: { type: "string" },
      },
      required: ["fileName", "fileSize", "mimeType"],
      type: "object",
    },
    CreateUploadResponse: {
      properties: {
        expiresIn: { type: "number" },
        fileKey: { type: "string" },
        maxFileSize: { type: "number" },
        method: { enum: ["PUT"], type: "string" },
        uploadUrl: { format: "uri", type: "string" },
      },
      required: ["expiresIn", "fileKey", "maxFileSize", "method", "uploadUrl"],
      type: "object",
    },
    BulkCardsRequest: {
      properties: {
        items: {
          items: { additionalProperties: true, type: "object" },
          type: "array",
        },
        operation: {
          enum: ["create", "update", "favorite", "delete"],
          type: "string",
        },
      },
      required: ["items", "operation"],
      type: "object",
    },
    BulkCardsResponse: {
      properties: {
        operation: {
          enum: ["create", "update", "favorite", "delete"],
          type: "string",
        },
        results: {
          items: { additionalProperties: true, type: "object" },
          type: "array",
        },
        summary: {
          properties: {
            failed: { type: "number" },
            succeeded: { type: "number" },
            total: { type: "number" },
          },
          required: ["failed", "succeeded", "total"],
          type: "object",
        },
      },
      required: ["operation", "results", "summary"],
      type: "object",
    },
    CardsPageResponse: {
      properties: {
        items: {
          items: { $ref: "#/components/schemas/CardListItem" },
          type: "array",
        },
        pageInfo: { $ref: "#/components/schemas/CardPageInfo" },
        total: { type: "number" },
      },
      required: ["items", "pageInfo"],
      type: "object",
    },
    CardChangesResponse: {
      properties: {
        deletedIds: { items: { type: "string" }, type: "array" },
        items: { items: { $ref: "#/components/schemas/Card" }, type: "array" },
        pageInfo: { $ref: "#/components/schemas/CardPageInfo" },
      },
      required: ["deletedIds", "items", "pageInfo"],
      type: "object",
    },
    UpdateCardRequest: {
      properties: {
        content: {
          description:
            "Replacement card content. Text-card Markdown is preserved exactly and is limited to 512 KiB measured in UTF-8 bytes.",
          example: "---\r\ntitle: Notes\r\n---\r\n\r\n# Heading  \r\n",
          type: "string",
        },
        metadataTitle: {
          description: `Replacement title, trimmed to at most ${MAX_CARD_TITLE_LENGTH} characters after trimming. Null or a blank string clears it.`,
          type: ["string", "null"],
        },
        notes: { type: ["string", "null"] },
        tags: { items: { type: "string" }, type: "array" },
        url: { type: "string" },
      },
      type: "object",
    },
    FavoriteRequest: {
      properties: {
        isFavorited: { type: "boolean" },
      },
      required: ["isFavorited"],
      type: "object",
    },
    TagSummary: {
      properties: {
        count: { type: "number" },
        name: { type: "string" },
      },
      required: ["count", "name"],
      type: "object",
    },
    TagsResponse: {
      properties: {
        items: {
          items: { $ref: "#/components/schemas/TagSummary" },
          type: "array",
        },
      },
      required: ["items"],
      type: "object",
    },
    HealthResponse: {
      properties: {
        service: { type: "string" },
        status: { type: "string" },
        version: { type: "string" },
      },
      required: ["service", "status", "version"],
      type: "object",
    },
    DiscoveryResponse: {
      properties: {
        auth: { type: "string" },
        endpoints: { items: { type: "string" }, type: "array" },
        mcp: {
          properties: {
            auth: { type: "string" },
            endpoint: { type: "string" },
            transport: { type: "string" },
          },
          required: ["auth", "endpoint", "transport"],
          type: "object",
        },
        version: { type: "string" },
      },
      required: ["auth", "endpoints", "mcp", "version"],
      type: "object",
    },
  },
  securitySchemes: {
    connectRevocation: {
      bearerFormat: "WorkOS Connect API access JWT",
      description:
        "Signed Connect token for https://teakvault.com/api. New application-wide disconnects require a live access token. Expired tokens can replay a completed receipt or resume an already acknowledged operation; API keys, refresh tokens and session tokens are rejected.",
      scheme: "bearer",
      type: "http",
    },
    bearerAuth: {
      bearerFormat: "OAuth access token or teakapi_ API key",
      description:
        "Bearer token. Accepts either an OAuth 2.0 access token (obtained via browser sign-in; expires after 1 hour and is refreshable) or a teakapi_ API key.",
      scheme: "bearer",
      type: "http",
    },
  },
} as const;

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Teak API",
    version: "v1",
    description: "Public API for creating, querying, and syncing Teak cards.",
  },
  servers: [
    { url: "https://teakvault.com/api" },
    { url: "https://api.teakvault.com" },
    { url: resolveTeakDevApiUrl(env) },
  ],
  components,
  paths: {
    "/v1/oauth/disconnect": {
      post: {
        operationId: "disconnectOAuthConsent",
        summary: "Disconnect this WorkOS Connect application",
        description:
          "No request body. Revokes this application on all installations for the signed-in user, while other applications stay connected. Old consent receipts remain permanently denied and successful retries return 204 without revoking a later grant. Works after authentication rollback. Reconnect may wait up to 305 seconds while old access tokens expire. Preserve local credentials unless 204 is returned; refresh an expired access token after 401 and retry.",
        security: [{ connectRevocation: [] }],
        responses: {
          204: {
            description:
              "Application disconnected or completed old receipt replayed",
          },
          401: {
            description:
              "Invalid or expired token, or conflicting consent binding",
          },
          503: {
            description:
              "Disconnect pending or unavailable; preserve credentials and retry",
          },
        },
      },
    },
    "/v1/me": {
      get: {
        operationId: "getMe",
        summary: "Get the authenticated Teak identity",
        security: apiKeySecurity,
        responses: {
          200: {
            description: "Permanent Teak owner ID and current profile",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id", "email"],
                      properties: {
                        id: {
                          type: "string",
                          description: "Permanent Teak owner ID",
                        },
                        email: { type: "string", format: "email" },
                        name: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: "Missing, invalid, expired, or revoked credential",
          },
          429: { description: "Rate limit exceeded" },
          500: { description: "Profile or authorization service unavailable" },
        },
      },
    },
    "/healthz": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
            description: "Service health",
          },
        },
        operationId: "getHealth",
        summary: "Health check",
      },
    },
    "/v1": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DiscoveryResponse" },
              },
            },
            description: "API discovery",
          },
        },
        operationId: "getApiDiscovery",
        summary: "List v1 endpoints",
      },
    },
    "/v1/cards": {
      get: {
        parameters: [
          { in: "query", name: "q", schema: { type: "string" } },
          { in: "query", name: "limit", schema: { type: "integer" } },
          { in: "query", name: "cursor", schema: { type: "string" } },
          {
            in: "query",
            name: "sort",
            schema: { enum: CARD_SORTS, type: "string" },
          },
          {
            in: "query",
            name: "type",
            description:
              "Repeat to match any selected card type, for example type=image&type=link.",
            explode: true,
            style: "form",
            schema: {
              items: { enum: CARD_TYPES, type: "string" },
              type: "array",
            },
          },
          { in: "query", name: "tag", schema: { type: "string" } },
          { in: "query", name: "favorited", schema: { type: "boolean" } },
          {
            in: "query",
            name: "trashed",
            schema: { type: "boolean" },
            description: "List only cards in Trash when true.",
          },
          ...["style", "hue", "hex"].map((name) => ({
            in: "query",
            name,
            explode: true,
            style: "form",
            schema: { type: "array", items: { type: "string" } },
            description:
              "Repeat to match any selected value within this filter.",
          })),
          { in: "query", name: "createdAfter", schema: { type: "number" } },
          { in: "query", name: "createdBefore", schema: { type: "number" } },
          {
            in: "query",
            name: "include",
            schema: { type: "string" },
            description:
              "Comma-separated values: content, metadata, processing",
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardsPageResponse" },
              },
            },
            description: "Paginated card list",
          },
          400: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiError" },
              },
            },
            description: "Invalid request",
          },
        },
        security: apiKeySecurity,
        operationId: "listCards",
        summary: "List cards",
      },
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateCardRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateCardResponse" },
              },
            },
            description: "Created card",
          },
        },
        security: apiKeySecurity,
        operationId: "createCard",
        summary: "Create a card",
      },
    },
    "/v1/uploads": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUploadRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateUploadResponse" },
              },
            },
            description: "Prepared direct file upload",
          },
        },
        security: apiKeySecurity,
        operationId: "createUpload",
        summary: "Create a presigned upload",
      },
    },
    "/v1/cards/bulk": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BulkCardsRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BulkCardsResponse" },
              },
            },
            description: "Bulk operation result",
          },
        },
        security: apiKeySecurity,
        operationId: "bulkCards",
        summary: "Execute bulk card operations",
      },
    },
    "/v1/cards/changes": {
      get: {
        parameters: [
          {
            in: "query",
            name: "since",
            required: true,
            schema: { type: "number" },
          },
          { in: "query", name: "cursor", schema: { type: "string" } },
          { in: "query", name: "limit", schema: { type: "integer" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CardChangesResponse" },
              },
            },
            description: "Incremental card changes",
          },
        },
        security: apiKeySecurity,
        operationId: "listCardChanges",
        summary: "List card changes since a timestamp",
      },
    },
    "/v1/cards/duplicate": {
      get: {
        operationId: "findDuplicateCard",
        summary: "Find a non-deleted card by exact URL",
        security: apiKeySecurity,
        parameters: [
          {
            in: "query",
            name: "url",
            required: true,
            schema: { type: "string", format: "uri", maxLength: 8192 },
          },
        ],
        responses: {
          200: {
            description: "Matching card ID, or null",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["cardId"],
                  properties: { cardId: { type: ["string", "null"] } },
                },
              },
            },
          },
          400: { description: "Invalid URL" },
          401: { description: "Invalid or revoked credentials" },
          429: { description: "Rate limit exceeded" },
        },
      },
    },
    "/v1/cards/{cardId}": {
      get: {
        parameters: [
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Card" },
              },
            },
            description: "Card details",
          },
        },
        security: apiKeySecurity,
        operationId: "getCard",
        summary: "Get a card",
      },
      patch: {
        parameters: [
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateCardRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Card" },
              },
            },
            description: "Updated card",
          },
        },
        security: apiKeySecurity,
        operationId: "updateCard",
        summary: "Update a card",
      },
      delete: {
        parameters: [
          {
            in: "query",
            name: "permanent",
            schema: { type: "boolean" },
            description:
              "Permanently remove the card and its files when true; otherwise move it to Trash.",
          },
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          204: { description: "Card deleted" },
        },
        security: apiKeySecurity,
        operationId: "deleteCard",
        summary: "Delete a card",
      },
    },
    "/v1/cards/{cardId}/restore": {
      post: {
        parameters: [
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { 204: { description: "Card restored" } },
        security: apiKeySecurity,
        operationId: "restoreCard",
        summary: "Restore a card from Trash",
      },
    },
    "/v1/cards/{cardId}/favorite": {
      patch: {
        parameters: [
          {
            in: "path",
            name: "cardId",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FavoriteRequest" },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Card" },
              },
            },
            description: "Updated favorite state",
          },
        },
        security: apiKeySecurity,
        operationId: "setCardFavorite",
        summary: "Set favorite state",
      },
    },
    "/v1/tags": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagsResponse" },
              },
            },
            description: "Tag summary list",
          },
        },
        security: apiKeySecurity,
        operationId: "listTags",
        summary: "List tags",
      },
    },
  },
} as const;

export const openApiV1 = httpAction(async () =>
  withPublicApiGatewayHeaders(
    new Response(JSON.stringify(openApiSpec), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    })
  )
);
