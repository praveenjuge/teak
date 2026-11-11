import { MAX_PINNED_CARDS } from "../../shared/pins";
import {
  PUBLIC_API_CARD_SORTS,
  PUBLIC_API_CARD_TYPES,
  SEARCH_MODES,
  SEARCH_QUERY_HELP,
} from "../../shared/publicApiContract";
import { PUBLIC_API_MAX_LIMIT } from "../../shared/publicApiLimits";
import {
  apiErrorContent,
  apiKeySecurity,
  cardIdParameter,
  doneErrorResponses,
  thumbnailErrorResponses,
} from "./components";
import type { OpenApiOperations } from "./operations";
import { requestBodySchema } from "./requestBodies";

const LIMIT_DESCRIPTION = `Page size, default 50. A whole number above ${PUBLIC_API_MAX_LIMIT} returns ${PUBLIC_API_MAX_LIMIT}; anything that isn't a whole number from 1 up is \`400 INVALID_INPUT\`.`;

export const cardOperations = {
  listCards: {
    parameters: [
      {
        in: "query",
        name: "q",
        description: `${SEARCH_QUERY_HELP} A \`-\` binds tightest, then a space, then \`OR\`; lowercase \`or\` and a \`-\` inside a word (\`to-do\`) are plain text. Several \`price:\` bounds make a range. Cards tagged \`secret\` or \`hidden\` (\`isHidden\`) are left out of every list unless the search names one of those tags: \`q=#secret\`, \`q=tag:hidden\` or \`tag=secret\` (\`-tag:hidden\` never shows them, and \`tag:hidden OR tag:x\` shows them only through the \`tag:hidden\` side). The plain word \`secret\` does not show them.`,
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
        description: LIMIT_DESCRIPTION,
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
          "Order by the date each card was last saved (`savedAt`): `newest` (default) or `oldest`. Saving a link that's already in Teak moves its card to the top of `newest`; an imported card keeps its original date. Or `shuffle`: a stable random order picked by `shuffleSeed`. A search, tag or folder shuffles its matches (a search its best 400, a tag or folder its newest 2,000). Or `relevance` (Best match), with `q`: the search's top 64 results by how well they match its words, then the rest in search order. Without `q` it is `newest`. The response's `relevanceRanked` says whether the top results were scored; the first page decides, and every later page keeps its order.",
        schema: { enum: PUBLIC_API_CARD_SORTS, type: "string" },
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
          items: { enum: PUBLIC_API_CARD_TYPES, type: "string" },
          type: "array",
        },
      },
      { in: "query", name: "tag", schema: { type: "string" } },
      { in: "query", name: "favorited", schema: { type: "boolean" } },
      {
        in: "query",
        name: "pinned",
        schema: { type: "boolean" },
        description:
          "Only cards pinned to the top of the library, like `q=is:pinned`. Without a search, the pinned cards come back in their pinned order as one page.",
      },
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
    summary: "List cards",
  },
  createCard: {
    description:
      "Saves a card. Saving a link that's already in Teak makes no second card: when the save is just the link (`url`, or `content` that is only the link) and a card outside Trash has the same link, ignoring `http`/`https`, `www.`, a trailing slash, a `#fragment` and `utm_*`/`fbclid`/`gclid` parameters, that card moves to the top of `sort=newest` and comes back from Archive. The response is still `status: \"created\"` with code 200, plus `resaved: true` (and `wasArchived: true` when it was archived). Tags and notes sent with a re-save are ignored; PATCH the card to add them. A re-save counts toward the rate limit but not the free plan's card limit. A link with other text in `content` always makes a new card. Replaying an `Idempotency-Key` returns the first response.",
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
  createUpload: {
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
    summary: "Create a presigned upload",
  },
  createPageSnapshotUpload: {
    requestBody: {
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/CreatePageSnapshotUploadRequest",
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
          "A signed URL. PUT the gzipped page to uploadUrl with Content-Type: application/gzip and exactly `bytes` bytes, then pass fileKey as pageSnapshotKey to POST /v1/cards",
      },
      400: {
        content: apiErrorContent,
        description: "INVALID_INPUT: `bytes` is missing or not a whole number",
      },
      413: {
        content: apiErrorContent,
        description: "PAGE_SNAPSHOT_TOO_LARGE: over 20 MiB gzipped",
      },
      429: {
        content: apiErrorContent,
        description:
          "RATE_LIMITED: 60 snapshots a minute; `retryAt` and Retry-After say when to try again",
      },
    },
    security: apiKeySecurity,
    summary: "Upload the page a link was saved from",
    description:
      "For a browser extension saving the page someone is looking at: the rendered HTML, gzipped, becomes the link's saved copy, so pages behind a sign-in or built by scripts are kept as they were seen. Teak keeps a private copy of each link's page either way; without a snapshot it fetches the page itself.",
  },
  bulkCards: {
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
  listCardChanges: {
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
        description: LIMIT_DESCRIPTION,
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
      400: {
        content: apiErrorContent,
        description:
          "INVALID_INPUT: `since` isn't a number, or `limit` isn't a whole number from 1 up",
      },
    },
    security: apiKeySecurity,
    summary: "List card changes since a timestamp",
  },
  reorderPinnedCards: {
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/PinOrderRequest" },
        },
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PinnedCardsResponse" },
          },
        },
        description: "The pinned cards in their new order",
      },
      400: {
        content: apiErrorContent,
        description:
          "INVALID_INPUT: `cardIds` doesn't list every pinned card exactly once",
      },
    },
    security: apiKeySecurity,
    summary: "Reorder pinned cards",
    description:
      "Sets the order of the cards pinned to the top of the library. List every pinned card's id once, first to last; get them with `GET /v1/cards?pinned=true`.",
  },
  findDuplicateCard: {
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
  getCard: {
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
  updateCard: {
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
      409: {
        description:
          "CONFLICT: the link has highlights, so its `url` can't change until they are removed",
      },
    },
    security: apiKeySecurity,
    summary: "Update a card",
  },
  deleteCard: {
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
    summary: "Delete a card",
  },
  restoreCard: {
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
    summary: "Restore a card from Trash",
  },
  getCardContent: {
    parameters: [
      {
        in: "path",
        name: "cardId",
        required: true,
        schema: { type: "string" },
      },
      {
        description:
          "Which text to return when a card has more than one. Without it the response is a document's text, then a transcript, then a note's content, and never `article`: ask for `article` to get a link's article.",
        in: "query",
        name: "kind",
        required: false,
        schema: {
          enum: ["article", "document", "transcript", "content"],
          type: "string",
        },
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
                    "document: text extracted from the card's file (PDF, Word, PowerPoint, text or code). transcript: the speech in its audio or video. content: a text or quote card's written text. article: a link's article from its saved copy, as Markdown whose images are signed URLs valid for 7 days; returned only for `?kind=article`.",
                  enum: ["document", "transcript", "content", "article"],
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
      400: {
        content: apiErrorContent,
        description: "INVALID_INPUT: `kind` isn't one of the listed kinds",
      },
      404: {
        description:
          "Card not found, or NO_CONTENT: the card has no stored text (of that `kind`, when given)",
      },
    },
    security: apiKeySecurity,
    summary: "Get a card's text",
  },
  refreshCard: {
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
    summary: "Refresh a card's details",
    description:
      "Clears the card's AI summary, tags and transcript, then runs the whole processing pipeline again: link metadata, previews, summary, tags and transcript.",
  },
  createThumbnailUpload: {
    parameters: [cardIdParameter],
    requestBody: {
      content: {
        "application/json": {
          schema: requestBodySchema("createThumbnailUpload"),
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
    summary: "Upload a link's image",
    description:
      "Starts replacing a link card's image. Works at the free plan's card limit: no card is created.",
  },
  setCardThumbnail: {
    parameters: [cardIdParameter],
    requestBody: {
      content: {
        "application/json": {
          schema: requestBodySchema("setCardThumbnail"),
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
    summary: "Replace a link's image",
    description:
      "Uses an uploaded image as the link card's image. It stays through Refresh details and new link previews until it is reset.",
  },
  resetCardThumbnail: {
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
    summary: "Reset a link's image",
    description:
      "Goes back to the image Teak found for the link and deletes the uploaded one.",
  },
  markCardDone: {
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
    summary: "Mark a link done",
    description:
      "Marks a link card read, watched, listened, bought, cooked, played or done, depending on its category. Only link cards can be marked done.",
  },
  unmarkCardDone: {
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
    summary: "Unmark a link done",
    description: "Clears a link card's done state.",
  },
  saveCardPdf: {
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
    summary: "Save a paper's PDF",
    description:
      "Saves an arXiv link's paper as its own document card. Saving the same link again returns that card; a save still running answers 409 IN_PROGRESS. Counts as a new card toward the plan's limit.",
  },
  setCardFavorite: {
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
  setCardPinned: {
    parameters: [cardIdParameter],
    requestBody: {
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/PinRequest" },
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
          "The card with its new `isPinned`. Pinning a pinned card, or unpinning one that isn't, changes nothing",
      },
      400: {
        content: apiErrorContent,
        description: `PIN_LIMIT_REACHED: ${MAX_PINNED_CARDS} cards are already pinned; unpin one first`,
      },
      404: { content: apiErrorContent, description: "Card not found" },
      409: {
        content: apiErrorContent,
        description:
          "CONFLICT: the card is archived; archived cards can't be pinned",
      },
    },
    security: apiKeySecurity,
    summary: "Pin or unpin a card",
    description: `Pins a card to the top of the library, or unpins it. A new pin goes first. Up to ${MAX_PINNED_CARDS} cards can be pinned, and archiving or trashing a card unpins it.`,
  },
} satisfies OpenApiOperations;
