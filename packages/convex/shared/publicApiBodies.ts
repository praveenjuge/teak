/**
 * The JSON bodies public API operations read, declared once as Zod schemas
 * beside `PUBLIC_API_OPERATIONS` (`publicApiContract.ts`). The REST handlers
 * parse with them (`parsePublicApiBody`), the OpenAPI document's request
 * bodies are generated from them (`requestBodySchema`), and MCP tools
 * take their fields as arguments. Descriptions and examples are `.meta()`,
 * so they reach both OpenAPI and MCP.
 *
 * A schema accepts exactly what the API accepts. Rules a schema can't state
 * as JSON Schema (a folder name's length in characters, a tag's) run as
 * refinements with the API's own words, and their limits are added to the
 * JSON Schema as metadata.
 *
 * `createCard`, `updateCard` and `bulkCards` still parse by hand in
 * `publicApi/http/payloads.ts`.
 */
import { z } from "zod";
import {
  explainInvalidFolderName,
  FOLDER_COLORS,
  MAX_FOLDER_AUTO_TAGS,
  MAX_FOLDER_CARD_IDS,
  MAX_FOLDER_NAME_LENGTH,
  MAX_FOLDER_RULES,
  MAX_SMART_FOLDER_QUERY_LENGTH,
} from "./folders";
import { PAGE_SNAPSHOT_MAX_BYTES } from "./pageArchive";
import { MAX_PINNED_CARDS } from "./pins";
import type { PublicApiOperationId } from "./publicApiContract";
import {
  explainInvalidTagName,
  explainInvalidTagSource,
  MAX_TAG_KEY_LENGTH,
  MAX_TAG_NAME_LENGTH,
} from "./tags";
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MIME_TYPES } from "./thumbnails";

export const THUMBNAIL_TYPES_DESCRIPTION =
  "JPEG, PNG, WebP, GIF (its first frame) or AVIF. SVG and HEIC are refused.";

/** `` `name` `` for messages. */
const code = (name: string) => `\`${name}\``;

const listNames = (names: readonly string[]): string => {
  const quoted = names.map(code);
  return quoted.length <= 2
    ? quoted.join(" and ")
    : `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
};

/** A trimmed string with at least one character. */
const filledString = (name: string) =>
  z
    .string({ error: `${code(name)} must be a string` })
    .trim()
    .min(1, { error: `${code(name)} can't be blank` });

/** A string a domain rule checks, with that rule's own words. */
const checkedString = (
  name: string,
  explain: (value: string) => string | null,
  limits: { maxLength: number; prefix?: boolean }
) =>
  z
    .string({ error: `${code(name)} must be a string` })
    .superRefine((value, ctx) => {
      const reason = explain(value);
      if (reason) {
        ctx.addIssue({
          code: "custom",
          message: limits.prefix ? `${code(name)}: ${reason}` : reason,
        });
      }
    })
    .meta({ minLength: 1, maxLength: limits.maxLength });

const flag = (name: string) =>
  z.boolean({ error: `${code(name)} must be true or false` });

/** Trimmed, without blanks or repeats. */
const stringList = (name: string, noun: string) =>
  z
    .array(z.string(), {
      error: `${code(name)} must be an array of ${noun}`,
    })
    .transform((values) => [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ]);

/** The fields of a manual folder's rules, for create and update. */
const folderRuleFields = {
  autoTags: stringList("autoTags", "strings")
    .pipe(
      z.array(z.string()).max(MAX_FOLDER_AUTO_TAGS, {
        error: `${code("autoTags")} must be an array of at most ${MAX_FOLDER_AUTO_TAGS} tags`,
      })
    )
    .meta({
      description: `Tags every card that joins this manual folder gets, at most ${MAX_FOLDER_AUTO_TAGS}. An empty array clears them. Up to ${MAX_FOLDER_RULES} folders per account can have rules.`,
      maxItems: MAX_FOLDER_AUTO_TAGS,
    })
    .optional(),
  autoFileQuery: z
    .string({ error: `${code("autoFileQuery")} must be a string or null` })
    .meta({ maxLength: MAX_SMART_FOLDER_QUERY_LENGTH })
    .nullable()
    .meta({
      description: `A search, with the qualifiers \`q\` accepts except \`like:\` and \`mood:\`, that files matching cards into this manual folder; at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters, or null to clear it.`,
    })
    .optional(),
  autoFileEnabled: flag("autoFileEnabled")
    .meta({
      description: "False pauses the auto-file search without clearing it.",
    })
    .optional(),
};

const folderName = checkedString("name", explainInvalidFolderName, {
  maxLength: MAX_FOLDER_NAME_LENGTH,
}).meta({
  description: `1 to ${MAX_FOLDER_NAME_LENGTH} characters, unique per account ignoring case.`,
});

const folderColor = z.enum(FOLDER_COLORS, {
  error: `${code("color")} must be one of: ${FOLDER_COLORS.join(", ")}`,
});

const folderKind = z.enum(["manual", "smart"], {
  error: `${code("kind")} must be ${code("manual")} or ${code("smart")}`,
});

const folderQuery = z
  .string({ error: `${code("query")} must be a string` })
  .meta({ maxLength: MAX_SMART_FOLDER_QUERY_LENGTH });

/** Rejects a body that isn't an object, or names a field it doesn't take. */
const body = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Body may include only ${listNames(Object.keys(shape))}`
        : "Body must be a JSON object",
  });

const UPDATE_FOLDER_FIELDS = [
  "name",
  "color",
  "query",
  "autoTags",
  "autoFileQuery",
  "autoFileEnabled",
] as const;

const folderCards = body({
  cardIds: stringList("cardIds", "card ids")
    .pipe(
      z
        .array(
          z
            .string()
            .max(64, { error: `${code("cardIds")} must contain card ids` })
        )
        .min(1, {
          error: `${code("cardIds")} must be a non-empty array of card ids`,
        })
        .max(MAX_FOLDER_CARD_IDS, {
          error: `${code("cardIds")} may name at most ${MAX_FOLDER_CARD_IDS} cards`,
        })
    )
    .meta({ minItems: 1, maxItems: MAX_FOLDER_CARD_IDS }),
});

const tagSource = (name: string, description: string) =>
  checkedString(name, explainInvalidTagSource, {
    maxLength: MAX_TAG_KEY_LENGTH,
    prefix: true,
  }).meta({ description });

const tagName = (name: string, description: string) =>
  checkedString(name, explainInvalidTagName, {
    maxLength: MAX_TAG_NAME_LENGTH,
    prefix: true,
  }).meta({ description });

const positiveSize = (name: string) =>
  z.number({ error: `${code(name)} must be a number` });

export const PUBLIC_API_BODIES = {
  createUpload: body({
    fileName: filledString("fileName"),
    fileSize: positiveSize("fileSize"),
    mimeType: filledString("mimeType"),
  }),
  createPageSnapshotUpload: body({
    bytes: z
      .number({ error: `${code("bytes")} must be a positive whole number` })
      .int({ error: `${code("bytes")} must be a positive whole number` })
      .positive({ error: `${code("bytes")} must be a positive whole number` })
      .max(Number.MAX_SAFE_INTEGER, {
        error: `${code("bytes")} must be a positive whole number`,
      })
      .meta({
        description: `The gzipped page's exact size in bytes; at most ${PAGE_SNAPSHOT_MAX_BYTES} (20 MiB).`,
      }),
  }),
  reorderPinnedCards: body({
    cardIds: z
      .array(z.string().min(1), {
        error: `${code("cardIds")} must be an array of card ids`,
      })
      .max(MAX_PINNED_CARDS, {
        error: `${code("cardIds")} may name at most ${MAX_PINNED_CARDS} cards`,
      })
      .meta({
        description: `Every pinned card's id exactly once, first to last. At most ${MAX_PINNED_CARDS}.`,
      }),
  }),
  createThumbnailUpload: body({
    fileSize: positiveSize("fileSize").meta({
      description: `Bytes; at most ${THUMBNAIL_MAX_BYTES} (20 MB).`,
    }),
    // The type is checked with the upload, which answers UNSUPPORTED_TYPE.
    mimeType: filledString("mimeType").meta({
      description: THUMBNAIL_TYPES_DESCRIPTION,
      enum: [...THUMBNAIL_MIME_TYPES],
    }),
  }),
  setCardThumbnail: body({
    fileKey: filledString("fileKey").meta({
      description:
        "From POST /v1/cards/{cardId}/thumbnail/upload, for this card",
    }),
  }),
  setCardFavorite: body({ isFavorited: flag("isFavorited") }),
  setCardPinned: body({ isPinned: flag("isPinned") }),
  renameTag: body({
    from: tagSource("from", "The tag to rename, matched ignoring case."),
    to: tagName("to", "The new name, written exactly as given."),
  }),
  mergeTags: body({
    from: tagSource("from", "The tag to merge away, matched ignoring case."),
    into: tagName("into", "The tag to keep."),
  }),
  deleteTag: body({
    tag: tagSource("tag", "The tag to delete, matched ignoring case."),
  }),
  createFolder: body({
    name: folderName,
    color: folderColor.meta({ description: "A palette color." }).optional(),
    kind: folderKind
      .meta({
        description:
          "`smart` saves a search as a folder and needs `query`. Defaults to `manual`.",
      })
      .optional(),
    query: folderQuery
      .meta({
        description: `A smart folder's search, with the qualifiers \`q\` accepts; at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters. A \`folder:\` must name one of your manual folders.`,
      })
      .optional(),
    ...folderRuleFields,
  }).superRefine((value, ctx) => {
    if (value.kind === "smart" && value.query === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "A smart folder needs a `query`",
      });
    }
    if (value.kind !== "smart" && value.query !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: '`query` needs `kind: "smart"`',
      });
    }
  }),
  updateFolder: body({
    name: folderName.optional(),
    color: z
      .enum(FOLDER_COLORS, {
        error: `${code("color")} must be one of: ${FOLDER_COLORS.join(", ")}, or null`,
      })
      .nullable()
      .meta({ description: "A palette color, or null to clear it." })
      .optional(),
    query: folderQuery
      .meta({
        description: `A smart folder's new search (at most ${MAX_SMART_FOLDER_QUERY_LENGTH} characters). Manual folders have none.`,
      })
      .optional(),
    ...folderRuleFields,
  })
    .refine(
      (value) =>
        UPDATE_FOLDER_FIELDS.some((field) => value[field] !== undefined),
      { message: `Body must include ${listNames(UPDATE_FOLDER_FIELDS)}` }
    )
    .meta({ minProperties: 1 }),
  addCardsToFolder: folderCards,
  removeCardsFromFolder: folderCards,
} as const satisfies Partial<Record<PublicApiOperationId, z.ZodType>>;

export type PublicApiBodyOperationId = keyof typeof PUBLIC_API_BODIES;
export type PublicApiBody<Id extends PublicApiBodyOperationId> = z.output<
  (typeof PUBLIC_API_BODIES)[Id]
>;

/** The first problem with a body, in the API's words. */
const explainIssues = (issues: readonly z.core.$ZodIssue[]): string => {
  // A field the body doesn't take outranks what's wrong with the others.
  const issue =
    issues.find((entry) => entry.code === "unrecognized_keys") ?? issues[0];
  if (!issue) {
    return "Body is invalid";
  }
  if (
    issue.code === "invalid_type" &&
    issue.path.length === 1 &&
    (issue as { input?: unknown }).input === undefined
  ) {
    return `Body must include ${code(String(issue.path[0]))}`;
  }
  return issue.message;
};

/** Parses an operation's JSON body: its value, or why it was refused. */
export const parsePublicApiBody = <Id extends PublicApiBodyOperationId>(
  operationId: Id,
  value: unknown
): { body: PublicApiBody<Id> } | { error: string } => {
  const parsed = PUBLIC_API_BODIES[operationId].safeParse(value, {
    reportInput: true,
  });
  return parsed.success
    ? { body: parsed.data as PublicApiBody<Id> }
    : { error: explainIssues(parsed.error.issues) };
};
