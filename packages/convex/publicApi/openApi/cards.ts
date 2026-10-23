import { PUBLIC_API_MAX_LIMIT } from "../../shared/publicApiLimits";
import { SEARCH_MODES } from "../../shared/search/semantic";
import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
} from "../../shared/thumbnails";
import {
  apiErrorContent,
  apiKeySecurity,
  CARD_SORTS,
  CARD_TYPES,
  cardIdParameter,
  doneErrorResponses,
  THUMBNAIL_TYPES_DESCRIPTION,
  thumbnailErrorResponses,
} from "./components";

export const cardPaths = {
  "/v1/cards": {
    get: {
      parameters: [
        {
          in: "query",
          name: "q",
          description:
            'Search text with optional qualifiers: `tag:design` or `#design`, `type:link`, `is:fav`, `is:archived`, `is:done` (links marked done), `is:todo` (articles, books, films, shows, podcasts, music, products, recipes, courses, events, apps and games not yet done), `site:github.com`, `folder:"Reading list"`, `like:<cardId>` (the cards closest in meaning to that card), `mood:"moody brutalist"` (images by mood), `price:<100` (also `>`, `<=`, `>=` and `=`, on the amount in any currency; only links with a price match), `text:"total due"` (only the words Teak read in images, video thumbnails, link previews and scanned PDFs) and `"quoted phrases"`. A `-` before a word, phrase or qualifier leaves those cards out (`design -figma`, `-tag:old`, `-is:archived`; not `like:` or `mood:`), uppercase `OR` matches either side (`tag:fonts OR tag:type`), and parentheses group (`(site:github.com OR site:gitlab.com) -is:archived`). A `-` binds tightest, then a space, then `OR`; lowercase `or` and a `-` inside a word (`to-do`) are plain text. Qualifiers combine with the other parameters; several `price:` bounds make a range. Cards tagged `secret` or `hidden` (`isHidden`) are left out of every list unless the search names one of those tags: `q=#secret`, `q=tag:hidden` or `tag=secret` (`-tag:hidden` never shows them, and `tag:hidden OR tag:x` shows them only through the `tag:hidden` side). The plain word `secret` does not show them.',
          schema: { type: "string" },
        },
        {
          in: "query",
          name: "similarTo",
          description:
            'A card id: only the cards closest to it in meaning, of any type, never the card itself (the same as `like:<id>` in `q`). Other parameters narrow them and `sort` orders them. A malformed id returns `400 INVALID_INPUT`; a card in Trash or not found returns no items with `similarity: "unavailable"`.',
          schema: { type: "string" },
        },
        {
          in: "query",
          name: "mode",
          description:
            "How `q` finds cards: `hybrid` (default) matches words and meaning, so `cozy reading nook` also finds a photo of an armchair by a window; `keyword` matches words only; `semantic` matches meaning only. Filters, qualifiers and `sort` apply in every mode. The response's `searchMode` says which ran.",
          schema: { default: "hybrid", enum: SEARCH_MODES, type: "string" },
        },
        {
          in: "query",
          name: "limit",
          schema: {
            maximum: PUBLIC_API_MAX_LIMIT,
            minimum: 1,
            type: "integer",
          },
        },
        { in: "query", name: "cursor", schema: { type: "string" } },
        {
          in: "query",
          name: "sort",
          description:
            "Order by the date each card was saved (`createdAt`, which keeps an imported card's original date): `newest` (default) or `oldest`. Or `shuffle`: a stable random order picked by `shuffleSeed`. A search, tag or folder shuffles its matches (a search its best 400, a tag or folder its newest 2,000). Or `relevance` (Best match), with `q`: the search's top 64 results by how well they match its words, then the rest in search order. Without `q` it is `newest`. The response's `relevanceRanked` says whether the top results were scored; the first page decides, and every later page keeps its order.",
          schema: { enum: CARD_SORTS, type: "string" },
        },
        {
          in: "query",
          name: "shuffleSeed",
          description:
            "Required with `sort=shuffle`: a whole number from 0 to 2147483647. The same seed gives the same order on every page and device; pick a new one to reshuffle. A `cursor` only works with the seed that issued it.",
          schema: { maximum: 2_147_483_647, minimum: 0, type: "integer" },
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
        {
          in: "query",
          name: "folder",
          schema: { type: "string" },
          description:
            "Only cards in this folder; for a smart folder, the cards its search matches (combined with `q`). An unknown folder returns 404.",
        },
        {
          in: "query",
          name: "archived",
          schema: { enum: ["exclude", "only", "include"], type: "string" },
          description:
            "Archived cards to list: `exclude` (the default) leaves them out, `only` lists just them, `include` lists them with the rest. Trash lists every trashed card whatever this says.",
        },
        ...["style", "hue", "hex"].map((name) => ({
          in: "query",
          name,
          explode: true,
          style: "form",
          schema: { type: "array", items: { type: "string" } },
          description: "Repeat to match any selected value within this filter.",
        })),
        { in: "query", name: "createdAfter", schema: { type: "number" } },
        { in: "query", name: "createdBefore", schema: { type: "number" } },
        {
          in: "query",
          name: "include",
          schema: { type: "string" },
          description: "Comma-separated values: content, metadata, processing",
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
        {
          in: "query",
          name: "limit",
          schema: {
            maximum: PUBLIC_API_MAX_LIMIT,
            minimum: 1,
            type: "integer",
          },
        },
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
      summary: "Find a non-deleted card saved from the same link",
      description:
        "Matches a card outside Trash saved from the same link, ignoring `http`/`https`, a leading `www.`, a trailing slash, a `#fragment` (except `#/` and `#!` routes) and `utm_*`, `fbclid` and `gclid` parameters. Other parameters, their order and the path's case count. Archived cards match; when several do, the newest is returned. Percent-encode `#` in the `url` parameter, or the client drops the fragment before sending.",
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
            "Permanently remove a card that is already in Trash, and its files, when true; otherwise move the card to Trash.",
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
        404: { description: "Card not found" },
        409: {
          description:
            "NOT_IN_TRASH: permanent deletes need the card in Trash first",
        },
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
  "/v1/cards/{cardId}/content": {
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
              schema: {
                properties: {
                  cardId: { type: "string" },
                  kind: {
                    description:
                      "document: text extracted from the card's file (PDF, Word, PowerPoint, text or code). transcript: the speech in its audio or video. content: a text or quote card's written text.",
                    enum: ["document", "transcript", "content"],
                    type: "string",
                  },
                  text: { type: "string" },
                  charCount: {
                    description: "Characters in the full stored text",
                    type: "number",
                  },
                  truncated: {
                    description:
                      "True when text is not the document's whole text. Teak keeps the first 500 pages of a PDF and at most 524,288 characters; when the stored text can't be read, its first 32 KiB is returned and text is shorter than charCount",
                    type: "boolean",
                  },
                },
                required: ["cardId", "kind", "text", "charCount", "truncated"],
                type: "object",
              },
            },
          },
          description: "The card's full stored text",
        },
        404: {
          description:
            "Card not found, or NO_CONTENT: the card has no stored text",
        },
      },
      security: apiKeySecurity,
      operationId: "getCardContent",
      summary: "Get a card's text",
    },
  },
  "/v1/cards/{cardId}/refresh": {
    post: {
      parameters: [
        {
          in: "path",
          name: "cardId",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        202: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  cardId: { type: "string" },
                  requestedAt: { type: "number" },
                  status: { const: "queued", type: "string" },
                },
                required: ["cardId", "requestedAt", "status"],
                type: "object",
              },
            },
          },
          description:
            "Processing queued. Poll GET /v1/cards/{cardId} until processingStatus settles",
        },
        404: { description: "Card not found" },
        409: { description: "The card is in Trash" },
        429: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiError" },
            },
          },
          description:
            "Re-run too soon: once per card per minute and six cards per minute; `retryAt` and Retry-After say when to try again",
        },
      },
      security: apiKeySecurity,
      operationId: "refreshCard",
      summary: "Refresh a card's details",
      description:
        "Clears the card's AI summary, tags and transcript, then runs the whole processing pipeline again: link metadata, previews, summary, tags and transcript.",
    },
  },
  "/v1/cards/{cardId}/thumbnail/upload": {
    post: {
      parameters: [cardIdParameter],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              additionalProperties: false,
              properties: {
                fileSize: {
                  description: `Bytes; at most ${THUMBNAIL_MAX_BYTES} (20 MB).`,
                  type: "number",
                },
                mimeType: {
                  description: THUMBNAIL_TYPES_DESCRIPTION,
                  enum: [...THUMBNAIL_MIME_TYPES],
                  type: "string",
                },
              },
              required: ["mimeType", "fileSize"],
              type: "object",
            },
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
          description:
            "A signed URL. PUT the bytes to uploadUrl with the same Content-Type, then pass fileKey to PUT /v1/cards/{cardId}/thumbnail",
        },
        ...thumbnailErrorResponses,
      },
      security: apiKeySecurity,
      operationId: "createThumbnailUpload",
      summary: "Upload a link's image",
      description:
        "Starts replacing a link card's image. Works at the free plan's card limit: no card is created.",
    },
  },
  "/v1/cards/{cardId}/thumbnail": {
    put: {
      parameters: [cardIdParameter],
      requestBody: {
        content: {
          "application/json": {
            schema: {
              additionalProperties: false,
              properties: {
                fileKey: {
                  description:
                    "From POST /v1/cards/{cardId}/thumbnail/upload, for this card",
                  type: "string",
                },
              },
              required: ["fileKey"],
              type: "object",
            },
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
          description:
            "The card, showing the new image as linkPreviewImageUrl with thumbnailOverridden true",
        },
        ...thumbnailErrorResponses,
      },
      security: apiKeySecurity,
      operationId: "setCardThumbnail",
      summary: "Replace a link's image",
      description:
        "Uses an uploaded image as the link card's image. It stays through Refresh details and new link previews until it is reset.",
    },
    delete: {
      parameters: [cardIdParameter],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Card" },
            },
          },
          description:
            "The card, back on the image Teak found (or its screenshot). Resetting a card without a chosen image changes nothing",
        },
        ...thumbnailErrorResponses,
      },
      security: apiKeySecurity,
      operationId: "resetCardThumbnail",
      summary: "Reset a link's image",
      description:
        "Goes back to the image Teak found for the link and deletes the uploaded one.",
    },
  },
  "/v1/cards/{cardId}/done": {
    post: {
      parameters: [cardIdParameter],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Card" },
            },
          },
          description:
            "The card with `completedAt` set. Marking a card that is already done keeps its first `completedAt`",
        },
        ...doneErrorResponses,
      },
      security: apiKeySecurity,
      operationId: "markCardDone",
      summary: "Mark a link done",
      description:
        "Marks a link card read, watched, listened, bought, cooked, played or done, depending on its category. Only link cards can be marked done.",
    },
    delete: {
      parameters: [cardIdParameter],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Card" },
            },
          },
          description:
            "The card with `completedAt` null. Unmarking a card that isn't done changes nothing",
        },
        ...doneErrorResponses,
      },
      security: apiKeySecurity,
      operationId: "unmarkCardDone",
      summary: "Unmark a link done",
      description: "Clears a link card's done state.",
    },
  },
  "/v1/cards/{cardId}/save-pdf": {
    post: {
      parameters: [cardIdParameter],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SavedPdf" },
            },
          },
          description:
            "The document an earlier save made from this link, with `created: false`",
        },
        201: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SavedPdf" },
            },
          },
          description: "A new document card holding the paper's PDF",
        },
        400: {
          content: apiErrorContent,
          description:
            "INVALID_INPUT: the card is not an arXiv link with a PDF (a withdrawn paper has none). CARD_LIMIT_REACHED: the free plan's card limit",
        },
        404: { content: apiErrorContent, description: "Card not found" },
        409: {
          content: apiErrorContent,
          description:
            "CONFLICT: the card is in Trash. IN_PROGRESS: a save of this PDF is still running; try again in a moment",
        },
        413: {
          content: apiErrorContent,
          description: "FILE_TOO_LARGE: the PDF is over 100 MB",
        },
        415: {
          content: apiErrorContent,
          description: "UNSUPPORTED_TYPE: arXiv didn't answer with a PDF",
        },
        429: {
          content: apiErrorContent,
          description:
            "RATE_LIMITED: 30 new cards a minute, as for creating cards",
        },
        503: {
          content: apiErrorContent,
          description: "SERVICE_UNAVAILABLE: arXiv couldn't be reached",
        },
      },
      security: apiKeySecurity,
      operationId: "saveCardPdf",
      summary: "Save a paper's PDF",
      description:
        "Saves an arXiv link's paper as its own document card. Saving the same link again returns that card; a save still running answers 409 IN_PROGRESS. Counts as a new card toward the plan's limit.",
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
} as const;
