/** The arguments Teak's MCP tools take, as the Zod schemas that check them. */
import { z } from "zod";
import { MAX_SOURCE_URL_LENGTH } from "../shared/cardSource";
import { COLOR_HUE_BUCKETS, VISUAL_STYLE_TAXONOMY } from "../shared/constants";
import {
  FOLDER_COLORS,
  MAX_FOLDER_AUTO_TAGS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "../shared/folders";
import {
  ARCHIVED_FILTERS,
  BULK_CARD_OPERATIONS,
  CARD_LIST_INCLUDES,
  MAX_SHUFFLE_SEED,
  MAX_VISUAL_FILTERS,
  PUBLIC_API_CARD_SORTS,
  PUBLIC_API_CARD_TYPES,
  PUBLIC_API_MAX_BULK_ITEMS,
  PUBLIC_API_MAX_LIMIT,
  SEARCH_MODES,
} from "../shared/publicApiContract";
import { MAX_TAG_KEY_LENGTH, MAX_TAG_NAME_LENGTH } from "../shared/tags";
import { MAX_PALETTE_COLORS } from "../shared/utils/colorUtils";

export const nonEmptyString = z.string().trim().min(1);
// Teak ids are letters, digits, `_` and `-`.
export const idSchema = nonEmptyString.regex(
  /^[A-Za-z0-9_-]+$/,
  "must be an id from Teak, like k57abc..."
);
export const limitSchema = z.number().int().min(1).max(PUBLIC_API_MAX_LIMIT);
export const cardTypeSchema = z.enum(PUBLIC_API_CARD_TYPES);
export const confirmSchema = z.literal(true);

export const cardFiltersShape = {
  q: z
    .string()
    .describe(
      'Search text with optional qualifiers: tag:name or #name, type:link, is:fav, is:pinned (cards pinned to the top), is:archived, is:done, is:todo, site:github.com, folder:"Reading list", like:<cardId> (cards similar in meaning to that card), mood:"moody brutalist" (images by mood), price:<100 (also >, <=, >= and =; links with a price only), text:"total due" (only the words Teak read in images, video thumbnails, link previews and scanned PDFs), and "quoted phrases". A - before a word, phrase or qualifier leaves those cards out (design -figma, -tag:old), uppercase OR matches either side (tag:fonts OR tag:type), and parentheses group: (site:github.com OR site:gitlab.com) -is:archived. Qualifiers combine with the other filters.'
    )
    .optional(),
  similarTo: nonEmptyString
    .describe(
      "A card id: only the cards closest to it in meaning (the same as like:<cardId> in q)"
    )
    .optional(),
  mode: z
    .enum(SEARCH_MODES)
    .describe(
      "How q finds cards: hybrid (default) matches words and meaning, keyword matches words only, semantic matches meaning only. The response's searchMode says which ran"
    )
    .optional(),
  limit: limitSchema.optional(),
  cursor: nonEmptyString
    .describe("pageInfo.nextCursor from the previous page")
    .optional(),
  type: z
    .union([cardTypeSchema, z.array(cardTypeSchema).min(1)])
    .describe("One card type, or several to match any of them")
    .optional(),
  favorited: z.boolean().describe("true lists favorites only").optional(),
  pinned: z
    .boolean()
    .describe(
      "true lists only cards pinned to the top of the library; without q they come back in their pinned order"
    )
    .optional(),
  trashed: z.boolean().describe("true lists cards in Trash only").optional(),
  archived: z
    .enum(ARCHIVED_FILTERS)
    .describe(
      "Archived cards: exclude (default) leaves them out, only lists just them, include lists them too"
    )
    .optional(),
  folder: nonEmptyString
    .describe("Only cards in this folder id (see teak_v1_list_folders)")
    .optional(),
  tag: nonEmptyString.describe("Exact tag").optional(),
  sort: z
    .enum(PUBLIC_API_CARD_SORTS)
    .describe(
      "newest (default) or oldest by saved date; shuffle: a stable random order (needs shuffleSeed); or relevance (Best match, with q): the top results by how well they match. relevanceRanked says whether they were scored"
    )
    .optional(),
  shuffleSeed: z
    .number()
    .int()
    .min(0)
    .max(MAX_SHUFFLE_SEED)
    .describe(
      "Required with sort shuffle; the same seed gives the same order, a new one reshuffles"
    )
    .optional(),
  createdAfter: z.number().describe("Unix ms").optional(),
  createdBefore: z.number().describe("Unix ms").optional(),
  style: z
    .array(z.enum(VISUAL_STYLE_TAXONOMY))
    .max(MAX_VISUAL_FILTERS)
    .optional(),
  hue: z.array(z.enum(COLOR_HUE_BUCKETS)).max(MAX_VISUAL_FILTERS).optional(),
  hex: z
    .array(nonEmptyString)
    .max(MAX_VISUAL_FILTERS)
    .describe("Exact colors such as #112233")
    .optional(),
  include: z
    .array(z.enum(CARD_LIST_INCLUDES))
    .describe(
      "Extra field sets. Defaults to content and metadata so items are full cards; content is always included."
    )
    .optional(),
};
export const cardFiltersSchema = z.strictObject(cardFiltersShape);
export const cardIdSchema = z.strictObject({ cardId: idSchema });
export const noArguments = z.strictObject({});

export const tagNameSchema = nonEmptyString.max(MAX_TAG_NAME_LENGTH);
// The tag being changed may be an older one longer than today's limit.
export const tagSourceSchema = nonEmptyString.max(MAX_TAG_KEY_LENGTH);
export const folderNameSchema = nonEmptyString.max(MAX_FOLDER_NAME_LENGTH);
export const smartFolderQuerySchema = nonEmptyString.max(
  MAX_SMART_FOLDER_QUERY_LENGTH
);
export const folderRuleInputFields = {
  autoTags: z.array(nonEmptyString).max(MAX_FOLDER_AUTO_TAGS).optional(),
  autoFileQuery: smartFolderQuerySchema.or(z.null()).optional(),
  autoFileEnabled: z.boolean().optional(),
};
export const folderCardsSchema = z.strictObject({
  folderId: idSchema,
  cardIds: z.array(nonEmptyString).min(1).max(MAX_FOLDER_CARD_IDS),
});
export const folderRuleRunSchema = z.strictObject({
  folderId: idSchema,
  runId: idSchema,
});
export const paletteColorsSchema = z
  .array(nonEmptyString)
  .min(1)
  .max(MAX_PALETTE_COLORS);

export const createCardSchema = z
  .strictObject({
    cardType: cardTypeSchema.optional(),
    content: z.string().optional(),
    idempotencyKey: nonEmptyString.optional(),
    fileEtag: nonEmptyString.optional(),
    fileKey: nonEmptyString.optional(),
    fileName: nonEmptyString.optional(),
    fileSize: z.number().positive().optional(),
    mimeType: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    source: nonEmptyString.optional(),
    sourceTitle: z.string().optional(),
    sourceUrl: nonEmptyString.max(MAX_SOURCE_URL_LENGTH).optional(),
    tags: z.array(z.string()).optional(),
    url: nonEmptyString.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fileKey) {
      if (!value.fileName) {
        ctx.addIssue({
          code: "custom",
          message: "fileName is required with fileKey",
          path: ["fileName"],
        });
      }
      if (!value.mimeType) {
        ctx.addIssue({
          code: "custom",
          message: "mimeType is required with fileKey",
          path: ["mimeType"],
        });
      }
      return;
    }
    if (
      (value.content === undefined && !value.url) ||
      (value.cardType !== "text" && !value.url && !value.content?.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        message: "content, url, or fileKey is required",
        path: ["content"],
      });
    }
  });

export const UPDATE_CARD_FIELDS = [
  "content",
  "url",
  "notes",
  "tags",
  "metadataTitle",
  "removeAiTags",
  "addColors",
  "removeColors",
] as const;
export const updateCardSchema = z
  .strictObject({
    cardId: idSchema,
    content: z.string().optional(),
    url: nonEmptyString.optional(),
    notes: z.string().or(z.null()).optional(),
    tags: z.array(z.string()).optional(),
    metadataTitle: z
      .string()
      .or(z.null())
      .describe("Card title; null or blank clears it")
      .optional(),
    removeAiTags: z.array(nonEmptyString).min(1).optional(),
    addColors: paletteColorsSchema
      .describe(
        `Palette cards only: hex codes to add. A palette holds up to ${MAX_PALETTE_COLORS} colors.`
      )
      .optional(),
    removeColors: paletteColorsSchema
      .describe(
        "Palette cards only: hex codes to remove. A palette keeps at least one color."
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (UPDATE_CARD_FIELDS.every((field) => value[field] === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: `At least one field must be provided: ${UPDATE_CARD_FIELDS.join(", ")}`,
        path: ["content"],
      });
    }
  });

export const createFolderSchema = z
  .strictObject({
    name: folderNameSchema,
    color: z.enum(FOLDER_COLORS).optional(),
    kind: z.enum(["manual", "smart"]).optional(),
    query: smartFolderQuerySchema.optional(),
    ...folderRuleInputFields,
  })
  .refine((value) => (value.kind === "smart") === (value.query !== undefined), {
    message: 'A smart folder needs `query`, and `query` needs kind "smart"',
    path: ["query"],
  });
export const UPDATE_FOLDER_FIELDS = [
  "name",
  "color",
  "query",
  "autoTags",
  "autoFileQuery",
  "autoFileEnabled",
] as const;
export const updateFolderSchema = z
  .strictObject({
    folderId: idSchema,
    name: folderNameSchema.optional(),
    color: z.enum(FOLDER_COLORS).or(z.null()).optional(),
    query: smartFolderQuerySchema.optional(),
    ...folderRuleInputFields,
  })
  .refine(
    (value) => UPDATE_FOLDER_FIELDS.some((field) => value[field] !== undefined),
    {
      message:
        "Provide name, color, query, autoTags, autoFileQuery or autoFileEnabled",
      path: ["name"],
    }
  );

export const bulkCardsSchema = z
  .strictObject({
    operation: z.enum(BULK_CARD_OPERATIONS),
    idempotencyKey: nonEmptyString.optional(),
    items: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(PUBLIC_API_MAX_BULK_ITEMS),
    confirm: confirmSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "delete" && value.confirm !== true) {
      ctx.addIssue({
        code: "custom",
        message: "confirm must be true for delete batches",
        path: ["confirm"],
      });
    }
  });
