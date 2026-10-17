import { env, httpAction } from "./_generated/server";
import { resolveTeakDevApiUrl } from "./devUrls";
import { MAX_TAG_LENGTH } from "./publicApiHttpShared";
import { withPublicApiGatewayHeaders } from "./publicApiMeta";
import {
  MAX_SOURCE_TITLE_LENGTH,
  MAX_SOURCE_URL_LENGTH,
} from "./shared/cardSource";
import { MAX_CARD_TITLE_LENGTH } from "./shared/cardTitle";
import {
  FOLDER_COLORS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDERS_PER_CARD,
  MAX_FOLDERS_PER_USER,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "./shared/folders";
import { SEARCH_MODES } from "./shared/search/semantic";
import { MAX_TAG_NAME_LENGTH, TAG_OPERATION_COUNT_LIMIT } from "./shared/tags";
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MIME_TYPES } from "./shared/thumbnails";

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
const CARD_SORTS = ["newest", "oldest", "relevance", "shuffle"] as const;
const apiKeySecurity = [{ bearerAuth: [] }];
const folderIdParameters = [
  {
    in: "path",
    name: "folderId",
    required: true,
    schema: { type: "string" },
  },
];
const cardIdParameter = {
  in: "path",
  name: "cardId",
  required: true,
  schema: { type: "string" },
} as const;
const THUMBNAIL_TYPES_DESCRIPTION =
  "JPEG, PNG, WebP, GIF (its first frame) or AVIF. SVG and HEIC are refused.";
const apiErrorContent = {
  "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
} as const;
const thumbnailErrorResponses = {
  400: {
    content: apiErrorContent,
    description: `TYPE_MISMATCH: not a link card. UNSUPPORTED_TYPE: not an accepted image type (${THUMBNAIL_TYPES_DESCRIPTION}). INVALID_INPUT: the image couldn't be read, or is over 10,000 pixels on a side`,
  },
  404: {
    content: apiErrorContent,
    description: "The card, or the upload for it, was not found",
  },
  409: { content: apiErrorContent, description: "The card is in Trash" },
  413: {
    content: apiErrorContent,
    description: "FILE_TOO_LARGE: images must be under 20 MB",
  },
  429: {
    content: apiErrorContent,
    description:
      "RATE_LIMITED: 20 image changes a minute; `retryAt` and Retry-After say when to try again",
  },
} as const;
const tagListSchema = {
  items: { maxLength: MAX_TAG_LENGTH, type: "string" },
  type: "array",
} as const;

const cardProperties = {
  aiOcrText: {
    description:
      "Text read from an image or a video thumbnail, up to 4,000 characters; null when it has none. Search it alone with `text:` in `q`.",
    type: ["string", "null"],
  },
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
  metadataStatus: { type: ["string", "null"] },
  processingStatus: {
    additionalProperties: true,
    description:
      "Per-stage processing state (classify, categorize, metadata, renderables, screenshot), or null once nothing is tracked.",
    type: ["object", "null"],
  },
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
  linkPrice: {
    description:
      "A product link's price, read from the page: `amount` in the page's currency and `currency` as an ISO 4217 code, or null when the page didn't say which. Null for cards without a price. `price:` in `q` compares `amount`.",
    properties: {
      amount: { type: "number" },
      currency: { type: ["string", "null"] },
    },
    required: ["amount", "currency"],
    type: ["object", "null"],
  },
  linkFaviconUrl: { type: ["string", "null"] },
  fileWidth: { type: ["number", "null"] },
  fileHeight: { type: ["number", "null"] },
  audioWaveform: {
    description:
      "Audio bar heights from 0 to 100: 45 for a grid card and 200 for a player. Null for other cards and audio saved before waveforms.",
    properties: {
      detail: { items: { type: "number" }, type: "array" },
      grid: { items: { type: "number" }, type: "array" },
    },
    required: ["grid", "detail"],
    type: ["object", "null"],
  },
  videoScrub: {
    description:
      "A horizontal JPEG strip of evenly spaced video frames for hover previews, `frames * frameWidth` wide. The URL is signed and expires. Null for other cards and videos saved before scrub strips.",
    properties: {
      frameHeight: { type: "number" },
      frameWidth: { type: "number" },
      frames: { type: "number" },
      url: { type: "string" },
    },
    required: ["url", "frames", "frameWidth", "frameHeight"],
    type: ["object", "null"],
  },
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
  archivedAt: {
    description: "When the card was archived, or null when it isn't.",
    type: ["number", "null"],
  },
  folderIds: {
    description: `Ids of the folders the card is in (at most ${MAX_FOLDERS_PER_CARD}).`,
    items: { type: "string" },
    type: "array",
  },
  isArchived: {
    description:
      "Archived cards are hidden from the library and listings unless you ask for them with `archived`.",
    type: "boolean",
  },
  isFavorited: { type: "boolean" },
  isHidden: {
    description:
      "True when one of the card's tags is `secret` or `hidden` (any case). Hidden cards are left out of every list and search unless the search names one of those tags, as `q=#secret`, `q=tag:hidden` or `tag=secret`. Getting the card by id, `/v1/cards/changes` and exports still include it. Read-only: change the tags to change it.",
    type: "boolean",
  },
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
  sourceTitle: {
    description:
      "The title of the page the card was saved from, beside `sourceUrl`.",
    type: ["string", "null"],
  },
  sourceUrl: {
    description:
      "The page the card was saved from, such as the page a quote was selected on. Set when the card is created; `site:` matches its host when the card has no `url`. Not the same as `source`, the free label sent at create.",
    type: ["string", "null"],
  },
  tags: { items: { type: "string" }, type: "array" },
  thumbnailOverridden: {
    description:
      "True when linkPreviewImageUrl is an image chosen for this link (PUT /v1/cards/{cardId}/thumbnail) rather than the one Teak found.",
    type: "boolean",
  },
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
        error: { type: "string" },
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
        "isArchived",
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
        aiOcrText: cardProperties.aiOcrText,
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
        audioWaveform: cardProperties.audioWaveform,
        videoScrub: cardProperties.videoScrub,
        fileUrl: { type: ["string", "null"] },
        id: { type: "string" },
        isDeleted: cardProperties.isDeleted,
        isArchived: cardProperties.isArchived,
        folderIds: cardProperties.folderIds,
        isFavorited: { type: "boolean" },
        isHidden: cardProperties.isHidden,
        linkPreviewImageUrl: { type: ["string", "null"] },
        linkPreviewDescription: cardProperties.linkPreviewDescription,
        linkFacts: cardProperties.linkFacts,
        linkFaviconUrl: cardProperties.linkFaviconUrl,
        linkPreviewTitle: cardProperties.linkPreviewTitle,
        linkPrice: cardProperties.linkPrice,
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
        metadataStatus: cardProperties.metadataStatus,
        processingStatus: cardProperties.processingStatus,
        screenshotUrl: { type: ["string", "null"] },
        sourceTitle: cardProperties.sourceTitle,
        sourceUrl: cardProperties.sourceUrl,
        tags: { items: { type: "string" }, type: "array" },
        thumbnailOverridden: cardProperties.thumbnailOverridden,
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
        "isArchived",
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
        nextCursor: {
          description:
            "Opaque cursor for the next page, or null on the last page. Pages resume after the last item returned, so cards added or removed between requests never repeat or skip items. Pass it back unchanged with the same filters; an invalid cursor returns 400.",
          type: ["string", "null"],
        },
      },
      required: ["hasMore", "nextCursor"],
      type: "object",
    },
    CreateCardRequest: {
      properties: {
        cardType: {
          description:
            "Optional explicit card type. Text content is stored as raw Markdown without normalization. When omitted, Teak keeps automatic URL, quote, and palette classification. Uploaded file types are inferred from fileName and mimeType. image, video, audio, and document need an uploaded file (fileKey); palette needs at least one readable color in content, notes, or tags.",
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
        source: {
          description:
            "A free label for what saved the card, kept in its metadata. To record the page a card came from, use `sourceUrl`.",
          type: "string",
        },
        sourceTitle: {
          description: `The title of the page in \`sourceUrl\`. Trimmed, and cut to ${MAX_SOURCE_TITLE_LENGTH} characters. Needs \`sourceUrl\`.`,
          type: "string",
        },
        sourceUrl: {
          description: `The page the card was saved from, such as the page a quote was selected on: an http or https URL of at most ${MAX_SOURCE_URL_LENGTH} characters. Unlike \`url\`, it never makes the card a link, and it isn't part of the duplicate check. Not allowed with \`fileKey\`.`,
          example: "https://example.com/essay",
          type: "string",
        },
        tags: tagListSchema,
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
      description:
        "Bulk operations do not accept `permanent`; permanently delete cards in Trash one at a time with DELETE /v1/cards/{cardId}?permanent=true.",
      properties: {
        items: {
          description: `Up to 100 items. \`create\` items take content, url, notes, tags, cardType, sourceUrl and sourceTitle; \`update\` items take cardId plus content, url, notes or tags; \`favorite\` items take cardId and isFavorited. \`delete\`, \`restore\`, \`archive\` and \`unarchive\` items take cardId. \`addTags\` and \`removeTags\` items take cardId and tags (up to 20, each at most ${MAX_TAG_LENGTH} characters); tags are matched ignoring case, and removeTags also clears tags Teak added. Repeating an operation on a card already in that state succeeds without changing it.`,
          items: { additionalProperties: true, type: "object" },
          type: "array",
        },
        operation: {
          enum: [
            "create",
            "update",
            "favorite",
            "delete",
            "archive",
            "unarchive",
            "addTags",
            "removeTags",
            "restore",
          ],
          type: "string",
        },
      },
      required: ["items", "operation"],
      type: "object",
    },
    BulkCardsResponse: {
      properties: {
        operation: {
          enum: [
            "create",
            "update",
            "favorite",
            "delete",
            "archive",
            "unarchive",
            "addTags",
            "removeTags",
            "restore",
          ],
          type: "string",
        },
        results: {
          description:
            'One result per item, in order: { index, status: "success", cardId } or { index, status: "error", code, error }. An item that fails changes nothing.',
          items: { additionalProperties: true, type: "object" },
          type: "array",
        },
        failedIds: {
          description:
            "The `cardId` of every item that failed, so a client can retry just those.",
          items: { type: "string" },
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
      required: ["operation", "results", "failedIds", "summary"],
      type: "object",
    },
    CardsPageResponse: {
      properties: {
        items: {
          items: { $ref: "#/components/schemas/CardListItem" },
          type: "array",
        },
        pageInfo: { $ref: "#/components/schemas/CardPageInfo" },
        similarity: {
          description:
            "With `similarTo`, `like:` or `mood:`: `pending` while the card is still being read (try again in a moment), `unavailable` for a card in Trash or not found.",
          enum: ["ok", "pending", "unavailable"],
          type: "string",
        },
        searchMode: {
          description:
            "With `q`: how the search found cards. `keyword` when meaning search was not used: `mode=keyword`, no words to search by meaning, or the meaning service was slow, down or rate-limited.",
          enum: SEARCH_MODES,
          type: "string",
        },
        relevanceRanked: {
          description:
            "With `q` and `sort=relevance`: whether the search's top results are ordered by how well they match. `false` when scoring was slow, failed, rate-limited, or AI is turned off for the account; the results then keep the search order.",
          type: "boolean",
        },
      },
      required: ["items", "pageInfo"],
      type: "object",
    },
    CardChangesResponse: {
      properties: {
        deletedIds: {
          description:
            "Cards moved to Trash or permanently deleted since `since`. Permanent deletions are reported for 90 days.",
          items: { type: "string" },
          type: "array",
        },
        items: { items: { $ref: "#/components/schemas/Card" }, type: "array" },
        pageInfo: { $ref: "#/components/schemas/CardPageInfo" },
      },
      required: ["deletedIds", "items", "pageInfo"],
      type: "object",
    },
    TagOperation: {
      description:
        "A library-wide tag change. It rewrites user and AI tags on every card, including cards in Trash and Archive, matching the tag ignoring case.",
      properties: {
        id: { type: "string" },
        kind: { enum: ["rename", "merge", "delete"], type: "string" },
        from: {
          description: "The tag being changed, lowercased.",
          type: "string",
        },
        to: {
          description: "The new name (rename) or the tag merged into (merge).",
          type: ["string", "null"],
        },
        status: { enum: ["running", "completed", "failed"], type: "string" },
        total: {
          description: `Cards carrying the tag when the change started (counted up to ${TAG_OPERATION_COUNT_LIMIT}).`,
          type: "number",
        },
        processed: { description: "Cards looked at so far.", type: "number" },
        changed: { description: "Cards rewritten so far.", type: "number" },
        error: { type: ["string", "null"] },
        createdAt: { type: "number" },
        updatedAt: { type: "number" },
        completedAt: { type: ["number", "null"] },
      },
      required: [
        "id",
        "kind",
        "from",
        "to",
        "status",
        "total",
        "processed",
        "changed",
        "error",
        "createdAt",
        "updatedAt",
        "completedAt",
      ],
      type: "object",
    },
    TagOperationStarted: {
      allOf: [
        { $ref: "#/components/schemas/TagOperation" },
        {
          properties: {
            operationId: {
              description: "Poll GET /v1/tags/operations/{operationId}.",
              type: "string",
            },
          },
          required: ["operationId"],
          type: "object",
        },
      ],
    },
    Folder: {
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        color: {
          enum: [...FOLDER_COLORS, null],
          type: ["string", "null"],
        },
        kind: {
          description:
            "`manual` folders hold the cards put in them; `smart` folders show the cards that match their `query` when listed.",
          enum: ["manual", "smart"],
          type: "string",
        },
        query: {
          description:
            "A smart folder's search (the same grammar as `q`), written the canonical way; null for a manual folder.",
          type: ["string", "null"],
        },
        cardCount: {
          description:
            "Cards in a manual folder that are not archived or in Trash; null for a smart folder, whose cards are found when listed.",
          type: ["number", "null"],
        },
        createdAt: { type: "number" },
        updatedAt: { type: "number" },
      },
      required: [
        "id",
        "name",
        "color",
        "kind",
        "query",
        "cardCount",
        "createdAt",
        "updatedAt",
      ],
      type: "object",
    },
    FolderCreateRequest: {
      properties: {
        name: {
          description: `1 to ${MAX_FOLDER_NAME_LENGTH} characters, unique per account ignoring case.`,
          type: "string",
        },
        color: {
          description: "A palette color.",
          enum: [...FOLDER_COLORS],
          type: "string",
        },
        kind: {
          description:
            "`smart` saves a search as a folder and needs `query`. Defaults to `manual`.",
          enum: ["manual", "smart"],
          type: "string",
        },
        query: {
          description: `A smart folder's search, with the qualifiers \`q\` accepts; at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters. A \`folder:\` must name one of your manual folders.`,
          type: "string",
        },
      },
      required: ["name"],
      type: "object",
    },
    FolderUpdateRequest: {
      minProperties: 1,
      properties: {
        name: {
          description: `1 to ${MAX_FOLDER_NAME_LENGTH} characters, unique per account ignoring case.`,
          type: "string",
        },
        color: {
          description: "A palette color, or null to clear it.",
          enum: [...FOLDER_COLORS, null],
          type: ["string", "null"],
        },
        query: {
          description: `A smart folder's new search (at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters). Manual folders have none.`,
          type: "string",
        },
      },
      type: "object",
    },
    FolderCardsRequest: {
      properties: {
        cardIds: {
          items: { type: "string" },
          maxItems: MAX_FOLDER_CARD_IDS,
          minItems: 1,
          type: "array",
        },
      },
      required: ["cardIds"],
      type: "object",
    },
    FolderCardsResult: {
      properties: {
        updatedIds: { items: { type: "string" }, type: "array" },
        failedIds: {
          description:
            "Cards left unchanged: missing, another account's, or (when adding) already in the most folders a card can be in.",
          items: { type: "string" },
          type: "array",
        },
        folderLimitIds: {
          description: `Failed cards that are already in ${MAX_FOLDERS_PER_CARD} folders.`,
          items: { type: "string" },
          type: "array",
        },
      },
      required: ["updatedIds", "failedIds", "folderLimitIds"],
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
          description: `Replacement title. Whitespace is trimmed and a longer title is cut to ${MAX_CARD_TITLE_LENGTH} characters. Null or a blank string clears it.`,
          type: ["string", "null"],
        },
        isArchived: {
          description:
            "True archives the card (hides it from the library without deleting it); false returns it to the library.",
          type: "boolean",
        },
        folderIds: {
          description: `Replaces the card's folders with these folder ids (at most ${MAX_FOLDERS_PER_CARD}). An empty list takes it out of every folder.`,
          items: { type: "string" },
          maxItems: MAX_FOLDERS_PER_CARD,
          type: "array",
        },
        notes: { type: ["string", "null"] },
        removeAiTags: {
          description:
            "AI tags to remove from the card. Tags Teak didn't add are ignored.",
          items: { type: "string" },
          type: "array",
        },
        tags: {
          ...tagListSchema,
          description: "Replaces the card's own tags.",
        },
        url: { type: "string" },
      },
      type: "object",
    },
    ExportJob: {
      properties: {
        id: { type: "string" },
        status: {
          enum: [
            "pending",
            "running",
            "ready",
            "failed",
            "canceled",
            "expired",
          ],
          type: "string",
        },
        stage: {
          enum: ["snapshotting", "archiving", null],
          type: ["string", "null"],
        },
        processedCount: { type: ["number", "null"] },
        cardCount: { type: ["number", "null"] },
        filesIncluded: { type: ["number", "null"] },
        filesOmitted: { type: ["number", "null"] },
        sizeBytes: { type: ["number", "null"] },
        failureClass: { type: ["string", "null"] },
        createdAt: { type: "number" },
        updatedAt: { type: "number" },
        completedAt: { type: ["number", "null"] },
        expiresAt: { type: ["number", "null"] },
        downloadUrl: {
          description:
            "Short-lived signed URL for the ZIP, present while the export is ready and not expired.",
          type: ["string", "null"],
        },
      },
      required: ["id", "status", "createdAt", "updatedAt", "downloadUrl"],
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
        isComplete: {
          description:
            "False when a very large library reached the listing's read limit and some tags or counts are missing.",
          type: "boolean",
        },
        items: {
          description:
            "Lowercase tag names on cards outside Trash and Archive, including tags Teak added, with the number of cards that have each. Any name works as the `tag` filter on GET /v1/cards.",
          items: { $ref: "#/components/schemas/TagSummary" },
          type: "array",
        },
      },
      required: ["isComplete", "items"],
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
    description:
      "Public API for creating, querying, and syncing Teak cards. A 429 response carries Retry-After, RateLimit-Remaining, and RateLimit-Reset in seconds, plus RateLimit-Limit when the limit is known. A 503 SERVICE_UNAVAILABLE response means the service was briefly busy; retry after its Retry-After seconds.",
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
                        cardCount: {
                          type: "number",
                          description: "Cards outside Trash",
                        },
                        cardLimit: {
                          type: ["number", "null"],
                          description: "Free plan card limit; null on Pro",
                        },
                        plan: { enum: ["free", "pro"], type: "string" },
                        settingsUrl: {
                          type: "string",
                          format: "uri",
                          description:
                            "Teak web Settings, where plan, billing, API keys and import live",
                        },
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
          {
            in: "query",
            name: "q",
            description:
              'Search text with optional qualifiers: `tag:design` or `#design`, `type:link`, `is:fav`, `is:archived`, `site:github.com`, `folder:"Reading list"`, `like:<cardId>` (the cards closest in meaning to that card), `mood:"moody brutalist"` (images by mood), `price:<100` (also `>`, `<=`, `>=` and `=`, on the amount in any currency; only links with a price match), `text:"total due"` (words read from an image or a video thumbnail, in `aiOcrText`) and `"quoted phrases"`. Qualifiers combine with the other parameters; several `price:` bounds make a range. Cards tagged `secret` or `hidden` (`isHidden`) are left out of every list unless the search names one of those tags: `q=#secret`, `q=tag:hidden` or `tag=secret`. The plain word `secret` does not show them.',
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
          { in: "query", name: "limit", schema: { type: "integer" } },
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
                  required: [
                    "cardId",
                    "kind",
                    "text",
                    "charCount",
                    "truncated",
                  ],
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
    "/v1/tags/rename": {
      post: {
        operationId: "renameTag",
        summary: "Rename a tag",
        description:
          "Renames a tag on every card. Renaming to a different casing of the same tag recases it. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                properties: {
                  from: {
                    description: "The tag to rename, matched ignoring case.",
                    maxLength: MAX_TAG_NAME_LENGTH,
                    type: "string",
                  },
                  to: {
                    description: "The new name, written exactly as given.",
                    maxLength: MAX_TAG_NAME_LENGTH,
                    type: "string",
                  },
                },
                required: ["from", "to"],
                type: "object",
              },
            },
          },
        },
        responses: {
          202: {
            description: "Tag change started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagOperationStarted" },
              },
            },
          },
          400: { description: "Invalid tag name" },
          404: { description: "No card has the tag" },
          409: {
            description:
              "Another tag change is still running (`TAG_OPERATION_RUNNING`) or a tag with the new name exists (`TAG_EXISTS`; merge into it instead)",
          },
        },
      },
    },
    "/v1/tags/merge": {
      post: {
        operationId: "mergeTags",
        summary: "Merge a tag into another",
        description:
          "Replaces a tag with another on every card; a card that has both keeps one. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                properties: {
                  from: {
                    description:
                      "The tag to merge away, matched ignoring case.",
                    maxLength: MAX_TAG_NAME_LENGTH,
                    type: "string",
                  },
                  into: {
                    description: "The tag to keep.",
                    maxLength: MAX_TAG_NAME_LENGTH,
                    type: "string",
                  },
                },
                required: ["from", "into"],
                type: "object",
              },
            },
          },
        },
        responses: {
          202: {
            description: "Tag change started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagOperationStarted" },
              },
            },
          },
          400: { description: "Invalid tag name" },
          404: { description: "No card has the tag" },
          409: {
            description:
              "Another tag change is still running (`TAG_OPERATION_RUNNING`)",
          },
        },
      },
    },
    "/v1/tags/delete": {
      post: {
        operationId: "deleteTag",
        summary: "Delete a tag",
        description:
          "Removes a tag from every card. The cards are kept. Returns at once; poll the operation for progress. One tag change runs at a time per account.",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                properties: {
                  tag: {
                    description: "The tag to delete, matched ignoring case.",
                    maxLength: MAX_TAG_NAME_LENGTH,
                    type: "string",
                  },
                },
                required: ["tag"],
                type: "object",
              },
            },
          },
        },
        responses: {
          202: {
            description: "Tag change started",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagOperationStarted" },
              },
            },
          },
          400: { description: "Invalid tag name" },
          404: { description: "No card has the tag" },
          409: {
            description:
              "Another tag change is still running (`TAG_OPERATION_RUNNING`)",
          },
        },
      },
    },
    "/v1/tags/operations/{operationId}": {
      get: {
        operationId: "getTagOperation",
        parameters: [
          {
            in: "path",
            name: "operationId",
            required: true,
            schema: { type: "string" },
          },
        ],
        summary: "Get a tag change's progress",
        security: apiKeySecurity,
        responses: {
          200: {
            description: "Tag operation",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TagOperation" },
              },
            },
          },
          404: { description: "Tag operation not found" },
        },
      },
    },
    "/v1/folders": {
      get: {
        operationId: "listFolders",
        summary: "List folders",
        description: "Every folder in the account, sorted by name.",
        security: apiKeySecurity,
        responses: {
          200: {
            description: "Folders",
            content: {
              "application/json": {
                schema: {
                  properties: {
                    items: {
                      items: { $ref: "#/components/schemas/Folder" },
                      type: "array",
                    },
                  },
                  required: ["items"],
                  type: "object",
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createFolder",
        summary: "Create a folder",
        description: `An account can have up to ${MAX_FOLDERS_PER_USER} folders.`,
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderCreateRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Folder created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Folder" },
              },
            },
          },
          400: { description: "Invalid name or color" },
          409: {
            description:
              "A folder with this name exists (`CONFLICT`) or the account has the most folders it can (`LIMIT_REACHED`)",
          },
        },
      },
    },
    "/v1/folders/{folderId}": {
      get: {
        operationId: "getFolder",
        parameters: folderIdParameters,
        summary: "Get a folder",
        security: apiKeySecurity,
        responses: {
          200: {
            description: "Folder",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Folder" },
              },
            },
          },
          404: { description: "Folder not found" },
        },
      },
      patch: {
        operationId: "updateFolder",
        parameters: folderIdParameters,
        summary: "Rename or recolor a folder",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderUpdateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Folder updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Folder" },
              },
            },
          },
          404: { description: "Folder not found" },
          409: { description: "A folder with this name exists" },
        },
      },
      delete: {
        operationId: "deleteFolder",
        parameters: folderIdParameters,
        summary: "Delete a folder",
        description:
          "Deletes the folder at once; its cards are kept and leave the folder shortly after.",
        security: apiKeySecurity,
        responses: {
          204: { description: "Folder deleted" },
          404: { description: "Folder not found" },
        },
      },
    },
    "/v1/folders/{folderId}/cards": {
      post: {
        operationId: "addCardsToFolder",
        parameters: folderIdParameters,
        summary: "Add cards to a folder",
        description: `Adding a card already in the folder succeeds without change. A card can be in up to ${MAX_FOLDERS_PER_CARD} folders.`,
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderCardsRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Per-card results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FolderCardsResult" },
              },
            },
          },
          404: { description: "Folder not found" },
          409: {
            description:
              "SMART_FOLDER: a smart folder shows the cards its search matches; cards cannot be added to it",
          },
        },
      },
      delete: {
        operationId: "removeCardsFromFolder",
        parameters: folderIdParameters,
        summary: "Remove cards from a folder",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FolderCardsRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Per-card results",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FolderCardsResult" },
              },
            },
          },
          404: { description: "Folder not found" },
          409: { description: "SMART_FOLDER: the folder is a smart folder" },
        },
      },
    },
    "/v1/exports": {
      post: {
        operationId: "startExport",
        summary: "Start a ZIP export of every card and original file",
        description:
          "One export can run at a time, and one can be started every 7 days. Poll GET /v1/exports/latest for progress and the download URL. The ZIP holds manifest.json, cards.json, the original files under files/, bookmarks.html (Netscape bookmark format) and cards.csv. manifest.json reports `schemaVersion: 2`: each card in cards.json also has `aiTags`, `aiSummary`, `metadataTitle`, `isArchived` and `folders` (names). A card saved from a page also has `sourceUrl` and `sourceTitle`.",
        security: apiKeySecurity,
        responses: {
          202: {
            description: "Export started",
            content: {
              "application/json": {
                schema: {
                  properties: {
                    job: { $ref: "#/components/schemas/ExportJob" },
                  },
                  required: ["job"],
                  type: "object",
                },
              },
            },
          },
          409: {
            description: "An export is already running; body includes `job`",
          },
          429: {
            description:
              "An export already ran in the last 7 days; `retryAt` and Retry-After say when the next can start",
          },
        },
      },
    },
    "/v1/exports/latest": {
      get: {
        operationId: "getLatestExport",
        summary: "Get the latest export and its download URL",
        security: apiKeySecurity,
        responses: {
          200: {
            description: "Latest export, or null if there has never been one",
            content: {
              "application/json": {
                schema: {
                  properties: {
                    job: {
                      oneOf: [
                        { $ref: "#/components/schemas/ExportJob" },
                        { type: "null" },
                      ],
                    },
                    canStartNew: { type: "boolean" },
                    nextAvailableAt: {
                      description:
                        "When the next export can start, or null if one can start now",
                      type: ["number", "null"],
                    },
                  },
                  required: ["job", "canStartNew", "nextAvailableAt"],
                  type: "object",
                },
              },
            },
          },
        },
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
