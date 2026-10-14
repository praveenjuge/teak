import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertAccountNotDeleting } from "../accountDeletion";
import { insertFolder } from "../folder/folders";
import type { CardType } from "../schema";
import { validateFileFormat } from "../shared/fileFormats";
import { type FolderColor, folderNameKey } from "../shared/folders";
import { parseSearchQuery } from "../shared/search/qualifiers";
import { buildColorFacets } from "../shared/utils/colorUtils";
import { normalizeUrlHost } from "../shared/utils/urlHost";
import { isFilesWorkerConfigured } from "../storage/filesWorkerClient";
import { buildR2UserPrefix } from "../storage/r2";
import { startWorkflow } from "../workflows/manager";
import {
  getOrInitializeCardUsage,
  initializeCardUsageShards,
  recordActiveCardCreated,
  recordActiveCardRemoved,
} from "./cardUsage";
import {
  buildInitialProcessingStatus,
  type ProcessingStatus,
  stageCompleted,
} from "./processingStatus";
import { scheduleCardSearchSync } from "./searchDocumentHelpers";

// Helper to create a fully completed processing status
const buildCompletedProcessingStatus = (now: number): ProcessingStatus => ({
  classify: stageCompleted(now, 1),
  categorize: stageCompleted(now, 1),
  metadata: stageCompleted(now, 1),
  renderables: stageCompleted(now, 1),
});

// Helper to create a color object
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

// Type for default card definitions - all properties are optional
export interface DefaultCardDef {
  aiSummary?: string;
  aiTags?: string[];
  colors?: ReturnType<typeof createColor>[];
  content: string;
  /** The saved date; defaults to the moment of insertion. */
  createdAt?: number;
  /** Dev scenario packs only: the folders the card starts in. */
  folderIds?: Id<"folders">[];
  /** Inserted archived (hidden from the library, still counted). */
  isArchived?: boolean;
  /** Inserted, then moved to the trash. */
  isDeleted?: boolean;
  isFavorited?: boolean;
  metadata?: Doc<"cards">["metadata"];
  metadataDescription?: string;
  metadataTitle?: string;
  notes?: string;
  /** Marks a getting-started card (see ONBOARDING_CARDS). */
  onboarding?: string;
  /** Inserted pending and handed to the card processing workflow. */
  runProcessing?: boolean;
  tags?: string[];
  type: CardType;
  url?: string;
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

/** True for a getting-started card, old or new. */
export const isOnboardingCard = (card: {
  content: string;
  onboarding?: string;
}): boolean =>
  card.onboarding !== undefined ||
  LEGACY_ONBOARDING_CARD_CONTENTS.includes(card.content);

/** Every getting-started card carries it, so `#getting-started` finds them. */
export const ONBOARDING_TAG = "getting-started";
/** The folder holding the getting-started cards. */
export const ONBOARDING_FOLDER = {
  name: "Start here",
  color: "orange",
} as const;
/** A smart folder that shows how saved searches fill themselves. */
export const ONBOARDING_SMART_FOLDER = {
  name: "Moodboard",
  color: "pink",
  query: "type:image type:palette",
} as const;

/** A file from card/onboarding that a getting-started card is made from. */
export interface OnboardingFile {
  height?: number;
  mimeType: string;
  /** The name the card shows. */
  name: string;
  /** The file in card/onboarding, embedded by scripts/onboarding-files.ts. */
  source: string;
  width?: number;
}

export interface OnboardingCardDef extends DefaultCardDef {
  /** Uploaded to the new account, then processed like any upload. */
  file?: OnboardingFile;
  onboarding: string;
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

/**
 * The getting-started cards, newest first, so the welcome card leads the grid.
 * Each one is an example of its card type, and its note says what to try.
 */
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
    file: {
      source: "coral-flowers.webp",
      name: "Coral flowers.webp",
      mimeType: "image/webp",
      width: 640,
      height: 640,
    },
    notes:
      "Teak pulled the colors out of this photo and tagged what's in it, so searching orange or pink finds it.",
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
    file: {
      source: "find-anything-in-teak.mp4",
      name: "Find anything in Teak.mp4",
      mimeType: "video/mp4",
    },
    notes:
      "A 20-second tour: find a photo by its color, a voice memo by what was said, and a smart folder that fills itself. Hover a video in the grid to scrub through it.",
  },
  {
    onboarding: "audio",
    type: "audio",
    content: "",
    file: {
      source: "brand-refresh-voice-memo.m4a",
      name: "Brand refresh voice memo.m4a",
      mimeType: "audio/mp4",
    },
    notes:
      "Record a thought with the microphone button, or upload a memo. Teak writes out what was said, so searching serif finds this card.",
  },
  {
    onboarding: "document",
    type: "document",
    content: "",
    file: {
      source: "teak-search-cheat-sheet.pdf",
      name: "Teak search cheat sheet.pdf",
      mimeType: "application/pdf",
    },
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
    notes:
      "Links get a preview, a screenshot, and a summary on their own. Get Teak for iPhone, iPad, Mac, Chrome, Safari, and Raycast here.",
    runProcessing: true,
  },
];

/**
 * Insert fully processed cards, one second apart so they keep their order.
 * Usage counts and search documents are kept in step, like any other card.
 * A `runProcessing` card is inserted pending instead and processed like a
 * newly created card.
 */
export const insertCompletedCards = async (
  ctx: MutationCtx,
  userId: string,
  cards: DefaultCardDef[],
  /** Dev scenario packs only: count the cards as on Pro, past the free cap. */
  options: { ignoreCardLimit?: boolean } = {}
): Promise<void> => {
  await initializeCardUsageShards(
    ctx,
    await getOrInitializeCardUsage(ctx, userId)
  );
  const now = Date.now();
  const processingStatus = buildCompletedProcessingStatus(now);
  for (const [i, cardDef] of cards.entries()) {
    const timestamp = cardDef.createdAt ?? now + i * 1000;
    const { colorHexes, colorHues } = buildColorFacets(cardDef.colors as any);
    const cardId = await ctx.db.insert("cards", {
      userId,
      type: cardDef.type,
      content: cardDef.content,
      url: cardDef.url,
      urlHost: normalizeUrlHost(cardDef.url) ?? undefined,
      tags: cardDef.tags,
      notes: cardDef.notes,
      colors: cardDef.colors as any,
      colorHexes,
      colorHues,
      aiTags: cardDef.aiTags,
      aiSummary: cardDef.aiSummary,
      isFavorited: cardDef.isFavorited,
      ...(cardDef.folderIds?.length ? { folderIds: cardDef.folderIds } : {}),
      metadata: cardDef.metadata,
      metadataTitle: cardDef.metadataTitle,
      metadataDescription: cardDef.metadataDescription,
      ...(cardDef.onboarding ? { onboarding: cardDef.onboarding } : {}),
      ...(cardDef.isArchived
        ? { isArchived: true as const, archivedAt: timestamp }
        : {}),
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
    if (cardDef.isDeleted) {
      await ctx.db.patch("cards", cardId, {
        isDeleted: true,
        deletedAt: timestamp,
      });
      await recordActiveCardRemoved(ctx, userId, cardId);
    }
    await scheduleCardSearchSync(ctx, cardId, userId);
    if (cardDef.runProcessing) {
      await startWorkflow(
        ctx,
        (internal as any)["workflows/cardProcessing"].cardProcessingWorkflow,
        { cardId },
        { startAsync: true }
      );
    }
  }
};

/**
 * The account's folder by this name, created when it has none. Null when the
 * name is taken by a smart folder or a folder being deleted, which cards
 * can't be added to.
 */
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

/**
 * Give a new account its getting-started cards: a Start here folder holding
 * one card of each type, and a Moodboard smart folder. Cards made from files
 * are uploaded by an action and arrive a moment later, already in their place
 * in the grid. Runs only while the account has no cards.
 */
export const createDefaultCardsForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await assertAccountNotDeleting(ctx, userId);
    const usage = await getOrInitializeCardUsage(ctx, userId);
    await initializeCardUsageShards(ctx, usage);
    // Check if user already has any non-deleted cards
    const existingCard = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", userId).eq("isDeleted", undefined)
      )
      .first();

    if (existingCard) {
      return { created: false, reason: "cards_exist" as const };
    }

    const now = Date.now();
    const folderId = await ensureFolder(ctx, userId, ONBOARDING_FOLDER, now);
    await ensureFolder(ctx, userId, ONBOARDING_SMART_FOLDER, now + 1);
    // Newest first: each card is a second older than the one before it.
    const planned = ONBOARDING_CARDS.map(({ file, ...card }, index) => ({
      card: {
        ...card,
        createdAt: now - index * 1000,
        tags: [ONBOARDING_TAG],
        ...(folderId ? { folderIds: [folderId] } : {}),
      },
      file,
    }));
    const inline = planned.filter(({ file }) => !file).map(({ card }) => card);
    await insertCompletedCards(ctx, userId, inline);
    // Without the Files Worker (a self-hosted setup without files), there is
    // nowhere to store the image, memo, PDF, and video.
    const files = isFilesWorkerConfigured()
      ? planned
          .filter(({ file }) => file)
          .map(({ card }) => ({
            onboarding: card.onboarding,
            createdAt: card.createdAt,
          }))
      : [];
    if (files.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.card.onboardingFiles.addOnboardingFileCards,
        { userId, folderId: folderId ?? undefined, cards: files }
      );
    }

    return { created: true, count: inline.length, files: files.length };
  },
});

/**
 * Insert a getting-started card for a file the onboarding action stored under
 * the account's prefix, and process it like an upload.
 */
export const insertOnboardingFileCard = internalMutation({
  args: {
    createdAt: v.number(),
    fileKey: v.string(),
    fileSize: v.number(),
    folderId: v.optional(v.id("folders")),
    onboarding: v.string(),
    userId: v.string(),
  },
  returns: v.union(v.id("cards"), v.null()),
  handler: async (ctx, args) => {
    await assertAccountNotDeleting(ctx, args.userId);
    const def = ONBOARDING_CARDS.find(
      (card) => card.onboarding === args.onboarding
    );
    if (!def?.file) {
      return null;
    }
    if (!args.fileKey.startsWith(`${buildR2UserPrefix(args.userId)}/`)) {
      throw new Error("Onboarding file key does not belong to the user");
    }
    const format = validateFileFormat({
      fileName: def.file.name,
      mimeType: def.file.mimeType,
    });
    const folder = args.folderId
      ? await ctx.db.get("folders", args.folderId)
      : null;
    const keepFolder =
      folder?.userId === args.userId &&
      folder.kind === "manual" &&
      folder.deletingAt === undefined;
    const now = Date.now();
    const cardId = await ctx.db.insert("cards", {
      userId: args.userId,
      type: format.cardType,
      content: def.content,
      fileKey: args.fileKey,
      fileMetadata: {
        extension: format.extension,
        fileName: def.file.name,
        fileSize: args.fileSize,
        kind: format.kind,
        mimeType: format.mimeType,
        ...(def.file.width ? { width: def.file.width } : {}),
        ...(def.file.height ? { height: def.file.height } : {}),
      },
      metadataTitle: def.file.name,
      notes: def.notes,
      tags: [ONBOARDING_TAG],
      onboarding: def.onboarding,
      ...(keepFolder && args.folderId ? { folderIds: [args.folderId] } : {}),
      processingStatus: buildInitialProcessingStatus({
        now,
        cardType: format.cardType,
        classificationStatus: stageCompleted(now, 1),
      }),
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
    await recordActiveCardCreated(ctx, args.userId, cardId);
    await scheduleCardSearchSync(ctx, cardId, args.userId);
    await ctx.scheduler.runAfter(
      0,
      (internal as any)["workflows/manager"].startCardProcessingWorkflow,
      { cardId }
    );
    return cardId;
  },
});
