import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertAccountNotDeleting } from "../accountDeletion";
import { insertFolder } from "../folder/folders";
import type { CardType } from "../schema";
import { type FolderColor, folderNameKey } from "../shared/folders";
import { parseSearchQuery } from "../shared/search/qualifiers";
import { isHiddenTagList } from "../shared/tags";
import { buildColorFacets } from "../shared/utils/colorUtils";
import { cardSiteHost } from "../shared/utils/urlHost";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { buildR2UserPrefix } from "../storage/r2";
import { queueCardProcessing } from "../workflowDispatch";
import {
  getOrInitializeCardUsage,
  initializeCardUsageShards,
  recordActiveCardCreated,
  recordActiveCardRemoved,
} from "./cardUsage";
import { AUDIO_TRANSCRIPT, AUDIO_WAVEFORM } from "./onboarding/processed";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  stageCompleted,
} from "./processingStatus";
import { syncCardSearch } from "./searchDocumentHelpers";
import { newShuffleKey } from "./shuffle";
import { storeCardTranscript } from "./textContents";

const buildCompletedProcessingStatus = (now: number): ProcessingStatus => ({
  classify: stageCompleted(now, 1),
  categorize: stageCompleted(now, 1),
  metadata: stageCompleted(now, 1),
  renderables: stageCompleted(now, 1),
});

const createColor = (
  hex: string,
  name?: string
): {
  hex: string;
  name?: string;
  rgb?: { r: number; g: number; b: number };
  hsl?: { h: number; s: number; l: number };
} => ({
  hex,
  ...(name && { name }),
});

export interface DefaultCardDef {
  aiSummary?: string;
  aiTags?: string[];
  aiTranscript?: string;
  colors?: ReturnType<typeof createColor>[];
  content: string;
  createdAt?: number;
  fileKey?: string;
  fileMetadata?: Doc<"cards">["fileMetadata"];
  isArchived?: boolean;
  isDeleted?: boolean;
  isFavorited?: boolean;
  metadata?: Doc<"cards">["metadata"];
  metadataDescription?: string;
  metadataTitle?: string;
  notes?: string;
  onboarding?: string;
  runProcessing?: boolean;
  scrubKey?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  tags?: string[];
  thumbnailKey?: string;
  type: CardType;
  url?: string;
}

/** A card a dev scenario pack seeds, in the state the scenario starts in. */
export interface DevScenarioCardDef extends DefaultCardDef {
  /** Text read from the image, filled in directly. */
  aiOcrText?: string;
  /** When the link was marked done. */
  completedAt?: number;
  folderIds?: Id<"folders">[];
  /** The Shuffle key, or `null` for none (a card saved before Shuffle). */
  shuffleKey?: number | null;
}

/**
 * The first onboarding cards' contents. Accounts made before the cards carried
 * `onboarding` still have them, so admin stats recognize them by content.
 */
export const LEGACY_ONBOARDING_CARD_CONTENTS: readonly string[] = [
  "Welcome to Teak! Start capturing your thoughts, links, and inspiration.",
  "The best way to predict the future is to invent it.",
  "Sunset gradient palette",
];

export const isOnboardingCard = (card: {
  content: string;
  onboarding?: string;
}): boolean =>
  card.onboarding !== undefined ||
  LEGACY_ONBOARDING_CARD_CONTENTS.includes(card.content);

export const ONBOARDING_TAG = "getting-started";
export const ONBOARDING_FOLDER = {
  name: "Start here",
  color: "orange",
} as const;
export const ONBOARDING_SMART_FOLDER = {
  name: "Moodboard",
  color: "pink",
  query: "type:image type:palette",
} as const;

export type OnboardingSlot =
  | "file"
  | "linkImage"
  | "screenshot"
  | "scrub"
  | "thumbnail";

export interface OnboardingUpload {
  mimeType: string;
  name: string;
  slot: OnboardingSlot;
  source: string;
}

export interface OnboardingStored {
  fileSize?: number;
  keys: Partial<Record<OnboardingSlot, string>>;
  onboarding: string;
}

export interface OnboardingCardDef extends DefaultCardDef {
  onboarding: string;
  uploads?: OnboardingUpload[];
}

const WELCOME_CONTENT = `Welcome to Teak, a home for everything that inspires you. Save links, images, videos, voice memos, PDFs, colors, and notes, and Teak helps you find them again.

## Save anything

- **Paste** a link, a note, or a hex color like #FF6B6B
- **Drop in** screenshots, mockups, videos, PDFs, and design files
- **Share** from your phone, or right-click any page with the browser extension

## Try these

- [ ] Save a link to a site you love
- [ ] Drop in a screenshot or a photo
- [ ] Search \`orange\` to find cards by color
- [ ] Open the **Moodboard** smart folder in the sidebar
- [ ] Get Teak on your phone and Mac from the Teak Apps card

These cards live in the **Start here** folder. When you're done exploring, select them and move them to Trash.`;

export const ONBOARDING_CARDS: OnboardingCardDef[] = [
  {
    onboarding: "welcome",
    type: "text",
    content: WELCOME_CONTENT,
    aiTags: ["welcome", "getting-started", "checklist"],
    aiSummary:
      "How to save links, images, files, and colors in Teak, with a checklist of first things to try.",
    isFavorited: true,
  },
  {
    onboarding: "image",
    type: "image",
    content: "",
    uploads: [
      {
        slot: "file",
        source: "coral-lily.webp",
        name: "Coral lily.webp",
        mimeType: "image/webp",
      },
    ],
    metadataTitle: "Coral lily.webp",
    fileMetadata: {
      extension: "webp",
      fileName: "Coral lily.webp",
      kind: "image",
      mimeType: "image/webp",
      width: 2400,
      height: 1600,
    },
    colors: [
      createColor("#FFA050"),
      createColor("#FFB060"),
      createColor("#FF9040"),
      createColor("#FFA040"),
      createColor("#FFC080"),
    ],
    aiTags: ["flower", "lily", "petal", "pollen", "macro", "nature"],
    aiSummary:
      "A macro close-up of an orange lily, focused on stamens covered in yellow pollen.",
    notes:
      "Teak pulled the colors out of this photo and tagged what's in it, so searching orange or lily finds it.",
  },
  {
    onboarding: "palette",
    type: "palette",
    content: "Sunset palette",
    colors: [
      createColor("#FF6B6B", "Coral Red"),
      createColor("#FFA06B", "Sunset Orange"),
      createColor("#FFD93D", "Golden Yellow"),
      createColor("#6BCB77", "Fresh Green"),
      createColor("#4D96FF", "Sky Blue"),
    ],
    notes:
      "Paste a few hex codes and Teak saves them as a palette. Click a swatch to copy its hex code.",
    aiTags: ["palette", "colors", "sunset", "warm", "ui"],
    aiSummary:
      "A warm sunset palette from coral red to sky blue, ready for a brand or UI.",
  },
  {
    onboarding: "video",
    type: "video",
    content: "",
    uploads: [
      {
        slot: "file",
        source: "find-anything-in-teak.mp4",
        name: "Find anything in Teak.mp4",
        mimeType: "video/mp4",
      },
      {
        slot: "thumbnail",
        source: "tour-thumbnail.jpg",
        name: "thumbnail.jpg",
        mimeType: "image/jpeg",
      },
      {
        slot: "scrub",
        source: "tour-scrub.jpg",
        name: "scrub.jpg",
        mimeType: "image/jpeg",
      },
    ],
    metadataTitle: "Find anything in Teak.mp4",
    fileMetadata: {
      extension: "mp4",
      fileName: "Find anything in Teak.mp4",
      kind: "motion",
      mimeType: "video/mp4",
      width: 1920,
      height: 1200,
      duration: 29.8,
      scrub: { frames: 10, frameWidth: 360, frameHeight: 224 },
    },
    aiTags: ["teak", "search", "interface", "design", "workspace"],
    aiSummary:
      "A short screen recording of Teak: finding a photo by color, a voice memo by a spoken word, and a smart folder of images and palettes.",
    notes:
      "A short tour: find a photo by its color, a voice memo by what was said, and a smart folder that fills itself. Hover a video in the grid to scrub through it.",
  },
  {
    onboarding: "audio",
    type: "audio",
    content: "",
    uploads: [
      {
        slot: "file",
        source: "brand-refresh-voice-memo.m4a",
        name: "Brand refresh voice memo.m4a",
        mimeType: "audio/mp4",
      },
    ],
    metadataTitle: "Brand refresh voice memo.m4a",
    fileMetadata: {
      extension: "m4a",
      fileName: "Brand refresh voice memo.m4a",
      kind: "audio",
      mimeType: "audio/mp4",
      duration: 17.8,
      waveform: AUDIO_WAVEFORM,
    },
    aiTranscript: AUDIO_TRANSCRIPT,
    aiTags: ["studio", "brand", "refresh", "coral", "serif", "layout"],
    aiSummary:
      "A note on the studio brand refresh: a coral main button, a warm serif headline, and calmer, roomier spacing.",
    notes:
      "Record a voice memo in Teak, or upload one. Teak writes out what was said, so searching serif finds this card.",
  },
  {
    onboarding: "document",
    type: "document",
    content: "",
    uploads: [
      {
        slot: "file",
        source: "teak-search-cheat-sheet.pdf",
        name: "Teak search cheat sheet.pdf",
        mimeType: "application/pdf",
      },
      {
        slot: "thumbnail",
        source: "cheat-sheet-thumbnail.png",
        name: "thumbnail.png",
        mimeType: "image/png",
      },
    ],
    metadataTitle: "Teak search cheat sheet.pdf",
    fileMetadata: {
      extension: "pdf",
      fileName: "Teak search cheat sheet.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      width: 1132,
      height: 1600,
    },
    aiTags: ["teak", "search", "filter", "moodboard", "pdf", "design"],
    aiSummary:
      "A one-page guide to searching in Teak: by color and style, by type, tag, site, and folder, by date, and by words.",
    notes:
      "Every search trick on one page. Teak reads the text inside PDFs, Office files, and design files, so you can search for what's in them.",
  },
  {
    onboarding: "quote",
    type: "quote",
    content: "Good design is as little design as possible.",
    notes:
      "Dieter Rams. Save any text wrapped in quotation marks and Teak keeps it as a quote.",
    aiTags: ["quote", "design", "dieter-rams", "minimalism"],
    aiSummary:
      "Dieter Rams on restraint: good design uses as little design as possible.",
  },
  {
    onboarding: "link",
    type: "link",
    content: "https://teakvault.com/apps",
    url: "https://teakvault.com/apps",
    uploads: [
      {
        slot: "linkImage",
        source: "apps-image.webp",
        name: "image.webp",
        mimeType: "image/webp",
      },
      {
        slot: "screenshot",
        source: "apps-screenshot.jpg",
        name: "screenshot.jpg",
        mimeType: "image/jpeg",
      },
    ],
    metadataTitle: "Teak Apps",
    metadataDescription:
      "Save ideas with Teak on Mac, iPhone, and iPad, web, browser extensions, and Raycast, with Android coming soon. Connect your library through the API, MCP, CLI, and agent skills.",
    metadata: {
      linkPreview: {
        source: "teak",
        status: "success",
        url: "https://teakvault.com/apps",
        finalUrl: "https://teakvault.com/apps",
        canonicalUrl: "https://teakvault.com/apps",
        title: "Teak Apps",
        description:
          "Save ideas with Teak on Mac, iPhone, and iPad, web, browser extensions, and Raycast, with Android coming soon. Connect your library through the API, MCP, CLI, and agent skills.",
        siteName: "Teak",
        author: "Teak Team",
        publisher: "Teak",
        faviconUrl: "https://teakvault.com/favicon.ico",
        imageUrl: "https://teakvault.com/hero-image.png",
        imageWidth: 1600,
        imageHeight: 840,
        screenshotWidth: 2560,
        screenshotHeight: 1440,
      },
      linkCategory: {
        category: "other",
        confidence: 0.35,
        detectedProvider: "teakvault.com",
        fetchedAt: 0,
        imageUrl: "https://teakvault.com/hero-image.png",
        sourceUrl: "https://teakvault.com/apps",
      },
    },
    aiTags: ["teak", "apps", "mac", "iphone", "raycast", "productivity"],
    aiSummary:
      "Where to get Teak: apps for Mac, iPhone, and iPad, the web, browser extensions, and Raycast, plus the API, MCP, CLI, and agent skills.",
    notes:
      "Links get a preview, a screenshot, and a summary on their own. Get Teak for iPhone, iPad, Mac, Chrome, Safari, and Raycast here.",
  },
];

export const insertCompletedCards = async (
  ctx: MutationCtx,
  userId: string,
  cards: readonly DevScenarioCardDef[],
  /** Dev scenario packs only: count the cards as on Pro, past the free cap. */
  options: { ignoreCardLimit?: boolean } = {}
): Promise<Id<"cards">[]> => {
  const ids: Id<"cards">[] = [];
  await initializeCardUsageShards(
    ctx,
    await getOrInitializeCardUsage(ctx, userId)
  );
  const now = Date.now();
  const processingStatus = buildCompletedProcessingStatus(now);
  for (const [i, cardDef] of cards.entries()) {
    const timestamp = cardDef.createdAt ?? now + i * 1000;
    const { colorHexes, colorHues } = buildColorFacets(cardDef.colors);
    const cardId = await ctx.db.insert("cards", {
      userId,
      type: cardDef.type,
      content: cardDef.content,
      url: cardDef.url,
      ...(cardDef.sourceUrl
        ? { sourceUrl: cardDef.sourceUrl, sourceTitle: cardDef.sourceTitle }
        : {}),
      urlHost: cardSiteHost(cardDef) ?? undefined,
      ...(cardDef.shuffleKey === null
        ? {}
        : { shuffleKey: cardDef.shuffleKey ?? newShuffleKey() }),
      tags: cardDef.tags,
      notes: cardDef.notes,
      colors: cardDef.colors,
      colorHexes,
      colorHues,
      aiTags: cardDef.aiTags,
      aiSummary: cardDef.aiSummary,
      ...(cardDef.aiOcrText
        ? { aiOcrText: cardDef.aiOcrText, ocrCheckedAt: timestamp }
        : {}),
      fileKey: cardDef.fileKey,
      fileMetadata: cardDef.fileMetadata,
      thumbnailKey: cardDef.thumbnailKey,
      scrubKey: cardDef.scrubKey,
      isFavorited: cardDef.isFavorited,
      ...(cardDef.folderIds?.length ? { folderIds: cardDef.folderIds } : {}),
      metadata: cardDef.metadata,
      metadataTitle: cardDef.metadataTitle,
      metadataDescription: cardDef.metadataDescription,
      ...(cardDef.onboarding ? { onboarding: cardDef.onboarding } : {}),
      ...(cardDef.isArchived
        ? { isArchived: true as const, archivedAt: timestamp }
        : {}),
      ...(cardDef.completedAt === undefined
        ? {}
        : { completedAt: cardDef.completedAt }),
      ...(isHiddenTagList(cardDef.tags) ? { isHidden: true as const } : {}),
      ...(cardDef.runProcessing
        ? {
            processingStatus: buildInitialProcessingStatus({
              now,
              cardType: cardDef.type,
              classificationStatus: stageCompleted(now, 1),
            }),
            ...(cardDef.type === "link" && {
              metadataStatus: "pending" as const,
            }),
          }
        : { metadataStatus: "completed" as const, processingStatus }),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await recordActiveCardCreated(ctx, userId, cardId, {
      hasPremium: options.ignoreCardLimit,
    });
    if (cardDef.aiTranscript) {
      await ctx.db.patch(
        "cards",
        cardId,
        await storeCardTranscript(
          ctx,
          { _id: cardId, userId },
          cardDef.aiTranscript
        )
      );
    }
    if (cardDef.isDeleted) {
      await ctx.db.patch("cards", cardId, {
        isDeleted: true,
        deletedAt: timestamp,
      });
      await recordActiveCardRemoved(ctx, userId, cardId);
    }
    await syncCardSearch(ctx, cardId, userId);
    if (
      cardDef.type === "document" &&
      cardDef.fileKey &&
      !(cardDef.runProcessing || cardDef.isDeleted)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.card.extractDocumentText.extractDocumentText,
        { cardId }
      );
    }
    if (cardDef.runProcessing) {
      await queueCardProcessing(ctx, cardId);
    }
    ids.push(cardId);
  }
  return ids;
};

const ensureFolder = async (
  ctx: MutationCtx,
  userId: string,
  folder: { color: FolderColor; name: string; query?: string },
  now: number
): Promise<Id<"folders"> | null> => {
  const existing = await ctx.db
    .query("folders")
    .withIndex("by_userId_and_nameKey", (q) =>
      q.eq("userId", userId).eq("nameKey", folderNameKey(folder.name))
    )
    .unique();
  if (existing) {
    return existing.kind === "manual" && existing.deletingAt === undefined
      ? existing._id
      : null;
  }
  return await insertFolder(
    ctx,
    userId,
    folder.name,
    folder.color,
    now,
    folder.query === undefined
      ? undefined
      : parseSearchQuery(folder.query).canonical
  );
};

export const finishOnboardingCard = (
  def: OnboardingCardDef,
  stored: OnboardingStored | undefined,
  now: number
): DefaultCardDef | null => {
  const { uploads, ...card } = def;
  const keys = stored?.keys ?? {};
  if (uploads?.some((upload) => !keys[upload.slot])) {
    if (card.type !== "link") {
      return null;
    }
    const { metadata: _metadata, ...unprocessed } = card;
    return {
      ...unprocessed,
      aiSummary: undefined,
      aiTags: undefined,
      metadataDescription: undefined,
      metadataTitle: undefined,
      runProcessing: true,
    };
  }
  const linkPreview = card.metadata?.linkPreview;
  const linkCategory = card.metadata?.linkCategory;
  return {
    ...card,
    ...(keys.file ? { fileKey: keys.file } : {}),
    ...(keys.thumbnail ? { thumbnailKey: keys.thumbnail } : {}),
    ...(keys.scrub ? { scrubKey: keys.scrub } : {}),
    ...(card.fileMetadata
      ? { fileMetadata: { ...card.fileMetadata, fileSize: stored?.fileSize } }
      : {}),
    ...(card.metadata
      ? {
          metadata: {
            ...card.metadata,
            ...(linkPreview && {
              linkPreview: {
                ...linkPreview,
                fetchedAt: now,
                imageStorageKey: keys.linkImage,
                imageUpdatedAt: now,
                screenshotStorageKey: keys.screenshot,
                screenshotUpdatedAt: now,
              },
            }),
            ...(linkCategory && {
              linkCategory: { ...linkCategory, fetchedAt: now },
            }),
          },
        }
      : {}),
  };
};

export const startVaultSetup = async (ctx: MutationCtx, userId: string) => {
  await ctx.db.insert("vaultSetups", { userId, startedAt: Date.now() });
};

const vaultSetupsOf = (ctx: MutationCtx, userId: string) =>
  ctx.db
    .query("vaultSetups")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(10);

const claimVaultSetup = async (
  ctx: MutationCtx,
  userId: string
): Promise<boolean> => {
  const rows = await vaultSetupsOf(ctx, userId);
  for (const row of rows) {
    await ctx.db.delete("vaultSetups", row._id);
  }
  return rows.length > 0;
};

export const ONBOARDING_BACKSTOP_MS = 5 * 60 * 1000;

const hasOnboardingCards = async (ctx: MutationCtx, userId: string) => {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_created", (q) => q.eq("userId", userId))
    .take(50);
  return cards.some((card) => card.onboarding !== undefined);
};

const insertOnboardingCardSet = async (
  ctx: MutationCtx,
  userId: string,
  createdAt: number,
  stored: OnboardingStored[]
) => {
  if (await hasOnboardingCards(ctx, userId)) {
    return 0;
  }
  const prefix = `${buildR2UserPrefix(userId)}/`;
  for (const entry of stored) {
    if (Object.values(entry.keys).some((key) => !key?.startsWith(prefix))) {
      throw new Error("Onboarding file key does not belong to the user");
    }
  }
  const now = Date.now();
  const folderId = await ensureFolder(ctx, userId, ONBOARDING_FOLDER, now);
  await ensureFolder(ctx, userId, ONBOARDING_SMART_FOLDER, now + 1);
  const byCard = new Map(stored.map((entry) => [entry.onboarding, entry]));
  const cards: DefaultCardDef[] = [];
  for (const [index, def] of ONBOARDING_CARDS.entries()) {
    const card = finishOnboardingCard(def, byCard.get(def.onboarding), now);
    if (card) {
      cards.push({
        ...card,
        createdAt: createdAt - index * 1000,
        tags: [ONBOARDING_TAG],
        ...(folderId ? { folderIds: [folderId] } : {}),
      });
    }
  }
  await insertCompletedCards(ctx, userId, cards);
  return cards.length;
};

export const createDefaultCardsForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await assertAccountNotDeleting(ctx, userId);
    const usage = await getOrInitializeCardUsage(ctx, userId);
    await initializeCardUsageShards(ctx, usage);
    const existingCard = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted_created", (q) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .first();

    if (existingCard) {
      await claimVaultSetup(ctx, userId);
      return { created: false, reason: "cards_exist" as const };
    }

    const createdAt = Date.now();
    if (isFilesWorkerConfigured()) {
      if ((await vaultSetupsOf(ctx, userId)).length === 0) {
        await startVaultSetup(ctx, userId);
      }
      await ctx.scheduler.runAfter(
        0,
        internal.card.onboardingFiles.addOnboardingCards,
        { userId, createdAt }
      );
      // Scheduled actions run at most once. If this one never inserts, the
      // backstop still gives the account the cards that need no files.
      await ctx.scheduler.runAfter(
        ONBOARDING_BACKSTOP_MS,
        internal.card.defaultCards.insertOnboardingCards,
        { userId, createdAt, stored: [] }
      );
      return { created: true, deferred: true as const };
    }
    await claimVaultSetup(ctx, userId);
    const count = await insertOnboardingCardSet(ctx, userId, createdAt, []);
    return { created: true, count };
  },
});

const onboardingSlotValidator = v.optional(v.string());

export const insertOnboardingCards = internalMutation({
  args: {
    createdAt: v.number(),
    stored: v.array(
      v.object({
        fileSize: v.optional(v.number()),
        keys: v.object({
          file: onboardingSlotValidator,
          linkImage: onboardingSlotValidator,
          screenshot: onboardingSlotValidator,
          scrub: onboardingSlotValidator,
          thumbnail: onboardingSlotValidator,
        }),
        onboarding: v.string(),
      })
    ),
    userId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, { createdAt, stored, userId }) => {
    await assertAccountNotDeleting(ctx, userId);
    if (!(await claimVaultSetup(ctx, userId))) {
      return 0;
    }
    return await insertOnboardingCardSet(ctx, userId, createdAt, stored);
  },
});
