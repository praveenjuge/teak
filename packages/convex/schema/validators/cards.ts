import { v } from "convex/values";
import { cardTypes } from "../../shared/constants";
import { FILE_KINDS } from "../../shared/fileFormats";
import { FOLDER_COLORS } from "../../shared/folders";
import { LINK_CATEGORIES } from "../../shared/linkCategories";
import { SEARCH_MODES } from "../../shared/search/semantic";

export const linkCategoryLiterals = [...LINK_CATEGORIES] as const;

export type LinkCategory = (typeof linkCategoryLiterals)[number];

export const linkCategoryValidator = v.union(
  ...linkCategoryLiterals.map((category) => v.literal(category))
);

export const cardTypeValidator = v.union(
  ...cardTypes.map((type) => v.literal(type))
);

export const searchModeValidator = v.union(
  ...SEARCH_MODES.map((mode) => v.literal(mode))
);

export const folderColorValidator = v.union(
  ...FOLDER_COLORS.map((color) => v.literal(color))
);

const stageStatusValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("failed")
  ),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  confidence: v.optional(v.number()),
  error: v.optional(v.string()),
});

export const processingStatusObjectValidator = v.object({
  classify: v.optional(stageStatusValidator),
  categorize: v.optional(stageStatusValidator),
  metadata: v.optional(stageStatusValidator),
  renderables: v.optional(stageStatusValidator),
  screenshot: v.optional(stageStatusValidator),
  /**
   * The link's saved copy (`pageArchive`). Never fails the card: a run with
   * nothing to archive leaves it as it was.
   */
  archive: v.optional(stageStatusValidator),
  /**
   * The article taken from the saved copy (`article`). Never fails the card:
   * a link without a copy closes it with no article.
   */
  article: v.optional(stageStatusValidator),
});

export const processingStatusValidator = v.optional(
  processingStatusObjectValidator
);

export const metadataStatusValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("failed")
);

export const stageSummaryValidator = v.object({
  pending: v.number(),
  inProgress: v.number(),
  failed: v.number(),
});

const linkCategoryFactValidator = v.object({
  label: v.string(),
  value: v.string(),
  icon: v.optional(v.string()),
});

export const linkCategoryMetadataValidator = v.object({
  category: linkCategoryValidator,
  confidence: v.optional(v.number()),
  detectedProvider: v.optional(v.string()),
  fetchedAt: v.number(),
  sourceUrl: v.string(),
  imageUrl: v.optional(v.string()),
  facts: v.optional(v.array(linkCategoryFactValidator)),
  price: v.optional(
    v.object({ amount: v.number(), currency: v.optional(v.string()) })
  ),
  pdfUrl: v.optional(v.string()),
  raw: v.optional(v.any()),
  rawStorageKey: v.optional(v.string()),
  rawSha256: v.optional(v.string()),
  rawHasStructured: v.optional(v.boolean()),
  rawStructuredFetchedAt: v.optional(v.number()),
});

export const filePreviewFactsValidator = v.object({
  animated: v.optional(v.boolean()),
  archiveDirectoryCount: v.optional(v.number()),
  archiveFileCount: v.optional(v.number()),
  characterCount: v.optional(v.number()),
  colorVariableCount: v.optional(v.number()),
  compressedBytes: v.optional(v.number()),
  headingCount: v.optional(v.number()),
  inspectedEntryCount: v.optional(v.number()),
  lineCount: v.optional(v.number()),
  slideCount: v.optional(v.number()),
  uncompressedBytes: v.optional(v.number()),
  wordCount: v.optional(v.number()),
});

export const fileProcessingProvenanceValidator = v.object({
  generatedAt: v.number(),
  processorVersion: v.string(),
  sourceEtag: v.string(),
  transformVersion: v.string(),
});

export const imageExifValidator = v.object({
  exposureTime: v.optional(v.number()),
  fNumber: v.optional(v.number()),
  focalLength: v.optional(v.number()),
  iso: v.optional(v.number()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  // Epoch ms read by released apps: an instant when the EXIF has an offset,
  // else the camera's clock time read as UTC.
  takenAt: v.optional(v.number()),
  // The camera's clock time as epoch ms, read as if that clock were UTC.
  takenAtClock: v.optional(v.number()),
  // Minutes east of UTC from the EXIF offset, when the camera recorded one.
  takenAtOffset: v.optional(v.number()),
});

export const fileMetadataValidator = v.optional(
  v.object({
    fileSize: v.optional(v.number()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    kind: v.optional(v.union(...FILE_KINDS.map((kind) => v.literal(kind)))),
    language: v.optional(v.string()),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    preview: v.optional(filePreviewFactsValidator),
    exif: v.optional(imageExifValidator),
    scrub: v.optional(
      v.object({
        frames: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
      })
    ),
    waveform: v.optional(
      v.object({
        grid: v.array(v.number()),
        detail: v.array(v.number()),
      })
    ),
    processing: v.optional(fileProcessingProvenanceValidator),
    recordingTimestamp: v.optional(v.number()),
  })
);

export const r2KeyValidator = v.string();

/**
 * A link's saved copy: one self-contained HTML file (role `page-archive`),
 * `text_only` when the page was too large to keep whole. `source` says
 * whether the browser extension sent the page or Teak fetched it.
 */
export const pageArchiveValidator = v.object({
  storageKey: r2KeyValidator,
  bytes: v.number(),
  kind: v.union(v.literal("full"), v.literal("text_only")),
  source: v.union(v.literal("server"), v.literal("extension")),
  capturedAt: v.number(),
  sourceUrl: v.string(),
});

/**
 * A link's article, taken from its saved copy for the reader: Markdown
 * (role `article-text`) whose images are `teak-image:<n>` references to
 * `imageKeys[n]` (role `article-image`, WebP). `none` is a page that isn't an
 * article (too little text). Both are named by their content.
 */
export const articleValidator = v.union(
  v.object({
    status: v.literal("ready"),
    textKey: r2KeyValidator,
    imageKeys: v.array(r2KeyValidator),
    wordCount: v.number(),
    readingMinutes: v.number(),
    title: v.optional(v.string()),
    byline: v.optional(v.string()),
    lang: v.optional(v.string()),
    /** The Markdown was cut to fit 512 KiB characters. */
    truncated: v.optional(v.literal(true)),
    extractedAt: v.number(),
  }),
  v.object({ status: v.literal("none"), extractedAt: v.number() })
);

export const highlightSourceValidator = v.union(
  v.literal("reader"),
  v.literal("api"),
  v.literal("import")
);

/**
 * A passage someone highlighted in a link's article, with an optional note.
 * `quote` with `prefix` and `suffix` find it again (a W3C TextQuote
 * selector); `start` and `end` are offsets into the article as the reader
 * shows it, and `articleKey` the article text they point into. An imported
 * highlight is `unanchored` until the card's article is there to find it in.
 */
export const highlightValidator = v.object({
  userId: v.string(),
  cardId: v.id("cards"),
  quote: v.string(),
  prefix: v.optional(v.string()),
  suffix: v.optional(v.string()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
  articleKey: v.optional(r2KeyValidator),
  note: v.optional(v.string()),
  unanchored: v.optional(v.literal(true)),
  source: highlightSourceValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const thumbnailOverrideValidator = v.object({
  storageKey: r2KeyValidator,
  width: v.number(),
  height: v.number(),
  updatedAt: v.number(),
});

export const metadataValidator = v.optional(
  v.object({
    source: v.optional(v.string()),
    linkPreview: v.optional(
      v.object({
        source: v.optional(v.string()),
        status: v.optional(v.union(v.literal("success"), v.literal("error"))),
        fetchedAt: v.optional(v.number()),
        url: v.optional(v.string()),
        finalUrl: v.optional(v.string()),
        canonicalUrl: v.optional(v.string()),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        media: v.optional(
          v.array(
            v.object({
              type: v.union(v.literal("image"), v.literal("video")),
              storageKey: v.optional(r2KeyValidator),
              updatedAt: v.number(),
              contentType: v.optional(v.string()),
              width: v.optional(v.number()),
              height: v.optional(v.number()),
              posterStorageKey: v.optional(r2KeyValidator),
              posterUpdatedAt: v.optional(v.number()),
              posterContentType: v.optional(v.string()),
              posterWidth: v.optional(v.number()),
              posterHeight: v.optional(v.number()),
            })
          )
        ),
        imageUrl: v.optional(v.string()),
        imageStorageKey: v.optional(r2KeyValidator),
        imageUpdatedAt: v.optional(v.number()),
        imageWidth: v.optional(v.number()),
        imageHeight: v.optional(v.number()),
        faviconUrl: v.optional(v.string()),
        siteName: v.optional(v.string()),
        author: v.optional(v.string()),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.string()),
        screenshotStorageKey: v.optional(r2KeyValidator),
        screenshotUpdatedAt: v.optional(v.number()),
        screenshotWidth: v.optional(v.number()),
        screenshotHeight: v.optional(v.number()),
        error: v.optional(
          v.object({
            type: v.optional(v.string()),
            message: v.optional(v.string()),
            details: v.optional(v.any()),
          })
        ),
        raw: v.optional(v.any()),
        rawStorageKey: v.optional(v.string()),
        rawSha256: v.optional(v.string()),
        categoryHint: v.optional(linkCategoryValidator),
      })
    ),
    linkCategory: v.optional(linkCategoryMetadataValidator),
  })
);

export const colorValidator = v.object({
  hex: v.string(),
  name: v.optional(v.string()),
  rgb: v.optional(
    v.object({
      r: v.number(),
      g: v.number(),
      b: v.number(),
    })
  ),
  hsl: v.optional(
    v.object({
      h: v.number(),
      s: v.number(),
      l: v.number(),
    })
  ),
});

export const cardValidator = v.object({
  userId: v.string(),
  content: v.string(),
  type: cardTypeValidator,
  url: v.optional(v.string()),
  urlHost: v.optional(v.string()),
  // `shared/utils/urlKey`: the key every variant of the link shares, for the
  // duplicate check. Set on cards with a `url`.
  urlKey: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  shuffleKey: v.optional(v.number()),
  fileKey: v.optional(r2KeyValidator),
  thumbnailKey: v.optional(r2KeyValidator),
  scrubKey: v.optional(r2KeyValidator),
  workflowArtifactKeys: v.optional(v.array(r2KeyValidator)),
  previewKey: v.optional(r2KeyValidator),
  placeholderHash: v.optional(v.string()),
  derivativeVersion: v.optional(v.string()),
  derivativeCheckedAt: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  isArchived: v.optional(v.literal(true)),
  archivedAt: v.optional(v.number()),
  /**
   * When the person marked this link read, watched, bought or otherwise
   * done (`is:done`). Not the processing stages' `completedAt`.
   */
  completedAt: v.optional(v.number()),
  isHidden: v.optional(v.literal(true)),
  folderIds: v.optional(v.array(v.id("folders"))),
  metadata: metadataValidator,
  fileMetadata: fileMetadataValidator,
  metadataStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
  ),
  metadataTitle: v.optional(v.string()),
  metadataTitleEdited: v.optional(v.boolean()),
  thumbnailOverride: v.optional(thumbnailOverrideValidator),
  previousThumbnailOverride: v.optional(
    v.object({
      override: v.union(thumbnailOverrideValidator, v.null()),
      changeId: v.string(),
      deleteAfter: v.number(),
      deletionJobId: v.optional(v.id("_scheduled_functions")),
    })
  ),
  thumbnailChangeId: v.optional(v.string()),
  metadataDescription: v.optional(v.string()),
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  /**
   * The language AI wrote `aiSummary` and `aiTags` in, as a BCP 47 primary
   * tag (`ja`, `es`, `en`): the content's main language. Set with them, and
   * cleared when new AI output has none. Not in search or the public API.
   */
  aiLanguage: v.optional(v.string()),
  /**
   * Unused: transcripts live in `cardTextContents`, and no card holds one
   * here. Dropped in a later deploy (.agents/records/sunset.md).
   */
  aiTranscript: v.optional(v.string()),
  /** Set when the transcript is in `cardTextContents`: its length. */
  aiTranscriptCharCount: v.optional(v.number()),
  aiTranscriptPreview: v.optional(v.string()),
  aiOcrText: v.optional(v.string()),
  ocrCheckedAt: v.optional(v.number()),
  documentTextKey: v.optional(r2KeyValidator),
  /** Links only: the saved copy of the page. */
  pageArchive: v.optional(pageArchiveValidator),
  /**
   * The page as the browser extension saw it (a gzipped pending upload), and
   * when it was taken, until the card's workflow archives it.
   */
  pendingPageSnapshotKey: v.optional(r2KeyValidator),
  pendingPageSnapshotAt: v.optional(v.number()),
  /** Links only: the article in the saved copy, for the reader. */
  article: v.optional(articleValidator),
  /**
   * Set while the card has rows in `highlights`, with their count; kept in
   * step by every highlight write. A highlighted link's saved copy and
   * article are frozen: nothing replaces them.
   */
  hasHighlights: v.optional(v.literal(true)),
  highlightCount: v.optional(v.number()),
  hasExtractedText: v.optional(v.literal(true)),
  extractedTextCharCount: v.optional(v.number()),
  visualStyles: v.optional(v.array(v.string())),
  aiBackfillAttempts: v.optional(v.number()),
  /** Set while the card has no AI summary, tags or transcript yet. */
  aiPending: v.optional(v.literal(true)),
  colors: v.optional(v.array(colorValidator)),
  colorHexes: v.optional(v.array(v.string())),
  colorHues: v.optional(v.array(v.string())),
  processingStatus: processingStatusValidator,
  processingRev: v.optional(v.number()),
  onboarding: v.optional(v.string()),
  createdAt: v.number(),
  // When the card was last saved: `createdAt` until the same link is saved
  // again. "Newest first" and date words order and bound by it. Every card
  // has it since the production backfill (October 2026); readers still read
  // `savedAt ?? createdAt` (`.agents/records/sunset.md`).
  savedAt: v.optional(v.number()),
  updatedAt: v.number(),
});
