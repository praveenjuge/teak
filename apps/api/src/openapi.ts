import { resolveTeakDevApiUrl } from "@teak/convex/dev-urls";

const apiKeySecurity = [{ bearerAuth: [] }];

const cardProperties = {
  aiSummary: { nullable: true, type: "string" },
  aiTags: { items: { type: "string" }, type: "array" },
  appUrl: { format: "uri", type: "string" },
  content: { type: "string" },
  createdAt: { type: "number" },
  fileUrl: { nullable: true, type: "string" },
  id: { type: "string" },
  isFavorited: { type: "boolean" },
  linkPreviewImageUrl: { nullable: true, type: "string" },
  metadataDescription: { nullable: true, type: "string" },
  metadataTitle: { nullable: true, type: "string" },
  notes: { nullable: true, type: "string" },
  screenshotUrl: { nullable: true, type: "string" },
  tags: { items: { type: "string" }, type: "array" },
  thumbnailUrl: { nullable: true, type: "string" },
  type: { type: "string" },
  updatedAt: { type: "number" },
  url: { nullable: true, type: "string" },
} as const;

const components = {
  schemas: {
    ApiError: {
      properties: {
        code: { type: "string" },
        details: { additionalProperties: true, nullable: true, type: "object" },
        error: { type: "string" },
        requestId: { nullable: true, type: "string" },
        retryAt: { nullable: true, type: "number" },
      },
      required: ["code", "error"],
      type: "object",
    },
    Card: {
      properties: cardProperties,
      required: [
        "aiTags",
        "appUrl",
        "content",
        "createdAt",
        "id",
        "isFavorited",
        "tags",
        "type",
        "updatedAt",
      ],
      type: "object",
    },
    CardListItem: {
      properties: {
        aiSummary: { nullable: true, type: "string" },
        aiTags: { items: { type: "string" }, type: "array" },
        appUrl: { format: "uri", type: "string" },
        content: { type: "string" },
        createdAt: { type: "number" },
        fileUrl: { nullable: true, type: "string" },
        id: { type: "string" },
        isFavorited: { type: "boolean" },
        linkPreviewImageUrl: { nullable: true, type: "string" },
        metadataDescription: { nullable: true, type: "string" },
        metadataTitle: { nullable: true, type: "string" },
        notes: { nullable: true, type: "string" },
        processingStatus: { nullable: true, type: "string" },
        screenshotUrl: { nullable: true, type: "string" },
        tags: { items: { type: "string" }, type: "array" },
        thumbnailUrl: { nullable: true, type: "string" },
        type: { type: "string" },
        updatedAt: { type: "number" },
        url: { nullable: true, type: "string" },
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
        nextCursor: { nullable: true, type: "string" },
      },
      required: ["hasMore", "nextCursor"],
      type: "object",
    },
    CreateCardRequest: {
      properties: {
        content: { type: "string" },
        notes: { nullable: true, type: "string" },
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
    LegacyCardsResponse: {
      properties: {
        items: { items: { $ref: "#/components/schemas/Card" }, type: "array" },
        total: { type: "number" },
      },
      required: ["items", "total"],
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
        content: { type: "string" },
        notes: { nullable: true, type: "string" },
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
    bearerAuth: {
      bearerFormat: "API key",
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
    { url: "https://api.teakvault.com" },
    { url: resolveTeakDevApiUrl(process.env) },
  ],
  components,
  paths: {
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
            schema: { enum: ["newest", "oldest"], type: "string" },
          },
          { in: "query", name: "type", schema: { type: "string" } },
          { in: "query", name: "tag", schema: { type: "string" } },
          { in: "query", name: "favorited", schema: { type: "boolean" } },
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
        summary: "Create a card",
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
        summary: "List card changes since a timestamp",
      },
    },
    "/v1/cards/search": {
      get: {
        parameters: [
          { in: "query", name: "q", schema: { type: "string" } },
          { in: "query", name: "limit", schema: { type: "integer" } },
          { in: "query", name: "type", schema: { type: "string" } },
          { in: "query", name: "tag", schema: { type: "string" } },
          {
            in: "query",
            name: "sort",
            schema: { enum: ["newest", "oldest"], type: "string" },
          },
          { in: "query", name: "favorited", schema: { type: "boolean" } },
          { in: "query", name: "createdAfter", schema: { type: "number" } },
          { in: "query", name: "createdBefore", schema: { type: "number" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LegacyCardsResponse" },
              },
            },
            description: "Legacy search response",
          },
        },
        security: apiKeySecurity,
        summary: "Search cards",
      },
    },
    "/v1/cards/favorites": {
      get: {
        parameters: [
          { in: "query", name: "q", schema: { type: "string" } },
          { in: "query", name: "limit", schema: { type: "integer" } },
          { in: "query", name: "type", schema: { type: "string" } },
          { in: "query", name: "tag", schema: { type: "string" } },
          {
            in: "query",
            name: "sort",
            schema: { enum: ["newest", "oldest"], type: "string" },
          },
          { in: "query", name: "favorited", schema: { type: "boolean" } },
          { in: "query", name: "createdAfter", schema: { type: "number" } },
          { in: "query", name: "createdBefore", schema: { type: "number" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LegacyCardsResponse" },
              },
            },
            description: "Legacy favorites response",
          },
        },
        security: apiKeySecurity,
        summary: "List favorite cards",
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
        summary: "Update a card",
      },
      delete: {
        parameters: [
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
        summary: "Delete a card",
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
        summary: "List tags",
      },
    },
  },
} as const;
