import {
  MAX_SOURCE_TITLE_LENGTH,
  MAX_SOURCE_URL_LENGTH,
} from "../../shared/cardSource";
import { MAX_CARD_TITLE_LENGTH } from "../../shared/cardTitle";
import {
  FOLDER_COLORS,
  MAX_FOLDER_AUTO_TAGS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_RULES,
  MAX_FOLDERS_PER_CARD,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "../../shared/folders";
import {
  HIGHLIGHT_SOURCES,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHT_QUOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "../../shared/highlights/constants";
import { PUBLIC_API_MAX_BULK_ITEMS } from "../../shared/publicApiLimits";
import { SEARCH_MODES } from "../../shared/search/semantic";
import { TAG_OPERATION_COUNT_LIMIT } from "../../shared/tags";
import { MAX_PALETTE_COLORS } from "../../shared/utils/colorUtils";
import { MAX_TAG_LENGTH } from "../http/shared";

export const CARD_TYPES = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;
export const CARD_SORTS = ["newest", "oldest", "relevance", "shuffle"] as const;
export const apiKeySecurity = [{ bearerAuth: [] }];
export const folderIdParameters = [
  {
    in: "path",
    name: "folderId",
    required: true,
    schema: { type: "string" },
  },
];
export const cardIdParameter = {
  in: "path",
  name: "cardId",
  required: true,
  schema: { type: "string" },
} as const;
export const THUMBNAIL_TYPES_DESCRIPTION =
  "JPEG, PNG, WebP, GIF (its first frame) or AVIF. SVG and HEIC are refused.";
export const apiErrorContent = {
  "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
} as const;
export const doneErrorResponses = {
  400: {
    content: apiErrorContent,
    description: "TYPE_MISMATCH: only link cards can be marked done",
  },
  404: { content: apiErrorContent, description: "Card not found" },
  409: { content: apiErrorContent, description: "The card is in Trash" },
  429: { content: apiErrorContent, description: "RATE_LIMITED" },
} as const;
export const thumbnailErrorResponses = {
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
  aiSummary: { type: ["string", "null"] },
  aiTags: { items: { type: "string" }, type: "array" },
  aiTranscript: {
    description:
      "What is said in the card: an audio or video file's transcript, a Vimeo video's captions, or a podcast episode's transcript.",
    type: ["string", "null"],
  },
  appUrl: { format: "uri", type: "string" },
  archive: {
    description:
      "A link's saved copy of its page, which Teak keeps privately and opens when the original is gone: `full` (text, styles and images, up to 20 MB) or `text_only` (the page was too large), its size in bytes and when it was taken. Null until the copy is saved, and for other cards. The copy itself stays in the app.",
    oneOf: [
      {
        properties: {
          bytes: { type: "number" },
          capturedAt: { type: "number" },
          kind: { enum: ["full", "text_only"], type: "string" },
        },
        required: ["kind", "bytes", "capturedAt"],
        type: "object",
      },
      { type: "null" },
    ],
  },
  article: {
    description:
      "A link's article, taken from its saved copy: its length in words and minutes to read. Null for other cards, until the article is ready, and for pages that aren't articles. Read it with `GET /v1/cards/{cardId}/content?kind=article`.",
    oneOf: [
      {
        properties: {
          readingMinutes: { type: "number" },
          wordCount: { type: "number" },
        },
        required: ["wordCount", "readingMinutes"],
        type: "object",
      },
      { type: "null" },
    ],
  },
  compactUrl: {
    description:
      "256px rendition URL for small cards; present for image uploads.",
    type: ["string", "null"],
  },
  content: { type: "string" },
  highlightCount: {
    description: `Passages highlighted in a link's article, up to ${MAX_HIGHLIGHTS_PER_CARD}; 0 for other cards. List them with \`GET /v1/cards/{cardId}/highlights\`.`,
    type: "number",
  },
  isDeleted: { type: "boolean" },
  metadataStatus: { type: ["string", "null"] },
  processingStatus: {
    additionalProperties: true,
    description:
      "Per-stage processing state (classify, categorize, metadata, renderables, screenshot, archive, article), or null once nothing is tracked.",
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
  linkCategory: {
    description:
      "What a link is, such as `article`, `movie`, `product` or `game`, or null before Teak has read it. A plain string: new categories are added over time, so accept values you don't know.",
    type: ["string", "null"],
  },
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
  completedAt: {
    description:
      "When the link was marked read, watched, bought or otherwise done (POST /v1/cards/{cardId}/done), or null when it isn't. `is:done` and `is:todo` in `q` filter on it.",
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
  savedAt: {
    description:
      "When the card was last saved. It starts equal to `createdAt` and moves to the time of the save when you save the same link again (POST /v1/cards answers `resaved: true`). `sort=newest` and `sort=oldest` order by it. `createdAt` stays the date the card was first saved.",
    type: "number",
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
  links: {
    description:
      "Cards this card links to with `[[Title|teak:<id>]]`, in the order they appear in `content`, at most 100. A link to a card in Trash, a deleted card or another account's card is `missing`, with a null `title` and `type`. Only on single-card responses: lists and the changes feed leave it out.",
    items: { $ref: "#/components/schemas/CardLinkRef" },
    type: "array",
  },
  linksTruncated: {
    description: "True when the card has more than 100 links.",
    type: "boolean",
  },
  backlinks: {
    description:
      "Your cards that link to this card, most recently updated first, at most 100; cards in Trash and hidden cards are left out. Only on single-card responses.",
    items: { $ref: "#/components/schemas/CardLinkRef" },
    type: "array",
  },
  backlinksTruncated: {
    description: "True when more than 100 cards link to this card.",
    type: "boolean",
  },
} as const;

export const components = {
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
    CardLinkRef: {
      properties: {
        id: { type: "string" },
        missing: {
          description:
            "True when the linked card is in Trash, deleted or not yours.",
          type: "boolean",
        },
        title: { type: ["string", "null"] },
        type: { type: ["string", "null"] },
      },
      required: ["id", "missing", "title", "type"],
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
        aiTranscript: cardProperties.aiTranscript,
        appUrl: { format: "uri", type: "string" },
        archive: cardProperties.archive,
        article: cardProperties.article,
        highlightCount: cardProperties.highlightCount,
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
        completedAt: cardProperties.completedAt,
        folderIds: cardProperties.folderIds,
        isFavorited: { type: "boolean" },
        isHidden: cardProperties.isHidden,
        linkPreviewImageUrl: { type: ["string", "null"] },
        linkPreviewDescription: cardProperties.linkPreviewDescription,
        linkFacts: cardProperties.linkFacts,
        linkFaviconUrl: cardProperties.linkFaviconUrl,
        linkPreviewTitle: cardProperties.linkPreviewTitle,
        linkCategory: cardProperties.linkCategory,
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
        savedAt: cardProperties.savedAt,
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
        pageSnapshotKey: {
          description:
            "From POST /v1/page-snapshots/upload: the page as the browser showed it, gzipped, which becomes the link's saved copy instead of the page Teak fetches. Only for links; a key that isn't one of your snapshot uploads is ignored, and the card is still saved. Not allowed with `fileKey`.",
          type: "string",
        },
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
        resaved: {
          description:
            "Present and true when the link was already in Teak: no card was made, and the card that has it moved to the top of `sort=newest` (its `savedAt` is now). `cardId` and `card` are that card. Tags, notes and content sent with the save were not applied; PATCH /v1/cards/{cardId} to add them.",
          enum: [true],
          type: "boolean",
        },
        status: {
          description: "Always `created`, also for a re-save: check `resaved`.",
          enum: ["created"],
          type: "string",
        },
        wasArchived: {
          description:
            "Present and true when the re-saved card was archived; it is back in the library.",
          enum: [true],
          type: "boolean",
        },
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
    CreatePageSnapshotUploadRequest: {
      additionalProperties: false,
      properties: {
        bytes: {
          description:
            "The gzipped page's exact size in bytes; at most 20971520 (20 MiB).",
          type: "integer",
        },
      },
      required: ["bytes"],
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
          description: `Up to ${PUBLIC_API_MAX_BULK_ITEMS} items. \`create\` items take content, url, notes, tags, cardType, pageSnapshotKey, sourceUrl and sourceTitle; \`update\` items take cardId plus content, url, notes or tags; \`favorite\` items take cardId and isFavorited. \`delete\`, \`restore\`, \`archive\` and \`unarchive\` items take cardId. \`addTags\` and \`removeTags\` items take cardId and tags (up to 20, each at most ${MAX_TAG_LENGTH} characters); tags are matched ignoring case, and removeTags also clears tags Teak added. Repeating an operation on a card already in that state succeeds without changing it.`,
          items: { additionalProperties: true, type: "object" },
          maxItems: PUBLIC_API_MAX_BULK_ITEMS,
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
            'One result per item, in order: { index, status: "success", cardId } or { index, status: "error", code, error }. A `create` item whose link was already in Teak adds `resaved: true` (and `wasArchived: true` when that card was archived): no card was made, and `cardId` is the existing card, moved to the top. The same link twice in one request makes one card, and the second item re-saves it. An item that fails changes nothing.',
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
    Highlight: {
      description:
        "A passage highlighted in a link's article, with an optional note.",
      properties: {
        id: { type: "string" },
        cardId: { type: "string" },
        quote: { description: "The highlighted text.", type: "string" },
        note: { type: ["string", "null"] },
        anchored: {
          description:
            "False while Teak hasn't found the quote in the card's saved article: an imported highlight waiting for the article, or one the article doesn't have.",
          type: "boolean",
        },
        source: {
          description:
            "Where it was made: in Teak's reader, through this API, or by an import. Clients should accept values they don't know.",
          enum: [...HIGHLIGHT_SOURCES],
          type: "string",
        },
        createdAt: { type: "number" },
        updatedAt: { type: "number" },
      },
      required: [
        "id",
        "cardId",
        "quote",
        "note",
        "anchored",
        "source",
        "createdAt",
        "updatedAt",
      ],
      type: "object",
    },
    HighlightCreateRequest: {
      properties: {
        quote: {
          description: `Text from the card's article, at most ${MAX_HIGHLIGHT_QUOTE_CHARS.toLocaleString("en")} characters. Whitespace, curly quotes, dash styles and case don't need to match.`,
          type: "string",
        },
        note: {
          description: `At most ${MAX_HIGHLIGHT_NOTE_CHARS.toLocaleString("en")} characters.`,
          type: "string",
        },
        prefix: {
          description:
            "Text just before the quote, to pick one of its repeats. Without it, or `suffix`, the first match is highlighted.",
          type: "string",
        },
        suffix: {
          description: "Text just after the quote, to pick one of its repeats.",
          type: "string",
        },
      },
      required: ["quote"],
      type: "object",
    },
    HighlightUpdateRequest: {
      properties: {
        note: {
          description: `The new note, at most ${MAX_HIGHLIGHT_NOTE_CHARS.toLocaleString("en")} characters, or null to clear it.`,
          type: ["string", "null"],
        },
      },
      required: ["note"],
      type: "object",
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
        rules: {
          description: "A manual folder's rules; null for a smart folder.",
          oneOf: [
            { $ref: "#/components/schemas/FolderRules" },
            { type: "null" },
          ],
        },
        ruleRunId: {
          description:
            "The folder's latest rule run, which saving its rules starts. Follow it with getFolderRuleRun.",
          type: ["string", "null"],
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
        "rules",
        "ruleRunId",
        "createdAt",
        "updatedAt",
      ],
      type: "object",
    },
    FolderRules: {
      properties: {
        autoTags: {
          description:
            "Tags every card that joins the folder gets, however it joins. They stay when the card leaves.",
          items: { type: "string" },
          type: "array",
        },
        autoFile: {
          description:
            "A search that files matching cards into the folder once their AI tags are written; null when the folder has none.",
          oneOf: [
            {
              properties: {
                query: { type: "string" },
                enabled: { type: "boolean" },
              },
              required: ["query", "enabled"],
              type: "object",
            },
            { type: "null" },
          ],
        },
      },
      required: ["autoTags", "autoFile"],
      type: "object",
    },
    FolderRuleRun: {
      description:
        "A pass of a folder's rules over the cards already in the library. It can be undone for 24 hours.",
      properties: {
        id: { type: "string" },
        folderId: { type: "string" },
        status: {
          enum: ["running", "done", "undoing", "undone", "superseded"],
          type: "string",
        },
        filedCount: {
          description: "Cards the run filed into the folder.",
          type: "number",
        },
        taggedCount: {
          description: "Cards the run added tags to.",
          type: "number",
        },
        canUndo: { type: "boolean" },
        createdAt: { type: "number" },
        completedAt: { type: ["number", "null"] },
      },
      required: [
        "id",
        "folderId",
        "status",
        "filedCount",
        "taggedCount",
        "canUndo",
        "createdAt",
        "completedAt",
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
        autoTags: {
          description: `Tags every card that joins this manual folder gets, at most ${MAX_FOLDER_AUTO_TAGS}. An empty array clears them. Up to ${MAX_FOLDER_RULES} folders per account can have rules.`,
          items: { type: "string" },
          maxItems: MAX_FOLDER_AUTO_TAGS,
          type: "array",
        },
        autoFileQuery: {
          description: `A search, with the qualifiers \`q\` accepts except \`like:\` and \`mood:\`, that files matching cards into this manual folder; at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters, or null to clear it.`,
          type: ["string", "null"],
        },
        autoFileEnabled: {
          description: "False pauses the auto-file search without clearing it.",
          type: "boolean",
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
        autoTags: {
          description: `Tags every card that joins this manual folder gets, at most ${MAX_FOLDER_AUTO_TAGS}. An empty array clears them. Up to ${MAX_FOLDER_RULES} folders per account can have rules.`,
          items: { type: "string" },
          maxItems: MAX_FOLDER_AUTO_TAGS,
          type: "array",
        },
        autoFileQuery: {
          description: `A search, with the qualifiers \`q\` accepts except \`like:\` and \`mood:\`, that files matching cards into this manual folder; at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters, or null to clear it.`,
          type: ["string", "null"],
        },
        autoFileEnabled: {
          description: "False pauses the auto-file search without clearing it.",
          type: "boolean",
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
        addColors: {
          description: `Palette cards only. Hex codes to add, such as #FF5500 or f50. A color the palette has is skipped, and a palette holds up to ${MAX_PALETTE_COLORS} colors.`,
          items: { type: "string" },
          maxItems: MAX_PALETTE_COLORS,
          minItems: 1,
          type: "array",
        },
        removeColors: {
          description:
            "Palette cards only. Hex codes to remove; every copy of each goes, and colors the palette doesn't have are ignored. A palette keeps at least one color. Removes apply before addColors, so one request can swap a color.",
          items: { type: "string" },
          maxItems: MAX_PALETTE_COLORS,
          minItems: 1,
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
    SavedPdf: {
      properties: {
        cardId: {
          description: "The document card holding the PDF",
          type: "string",
        },
        created: {
          description: "False when an earlier save already made the card",
          type: "boolean",
        },
      },
      required: ["cardId", "created"],
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
