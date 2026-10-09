import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardTypeValidator } from "../schema";
import {
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./getCards";
import type { CardWithUrls } from "./queryUtils";

const CONTENT_PREVIEW_LENGTH = 280;
const WWW_PREFIX = /^www\./;

const mobileCardSummaryValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("cards"),
  /** Width / height of the tile's media, so grids reserve space before it loads. */
  aspectRatio: v.optional(v.number()),
  colors: v.optional(v.array(v.string())),
  compactUrl: v.optional(v.string()),
  fileName: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  linkPreviewImageUrl: v.optional(v.string()),
  placeholderUrl: v.optional(v.string()),
  previewText: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  title: v.string(),
  type: cardTypeValidator,
  url: v.optional(v.string()),
});

const paginationResultValidator = v.object({
  continueCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
  page: v.array(mobileCardSummaryValidator),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())
  ),
  splitCursor: v.optional(v.union(v.string(), v.null())),
});

const compactText = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }
  return normalized.slice(0, CONTENT_PREVIEW_LENGTH);
};

const ratio = (width?: number, height?: number) =>
  width && height && width > 0 && height > 0 ? width / height : undefined;

/** The aspect ratio of the media a grid tile shows for this card, if known. */
const mediaAspectRatio = (card: CardWithUrls) => {
  if (card.type === "link") {
    const preview = card.metadata?.linkPreview;
    return card.linkPreviewImageUrl
      ? ratio(preview?.imageWidth, preview?.imageHeight)
      : ratio(preview?.screenshotWidth, preview?.screenshotHeight);
  }
  return ratio(card.fileMetadata?.width, card.fileMetadata?.height);
};

/** "example.com" for an untitled link, so its tile names the site. */
const linkHostname = (url?: string) => {
  if (!url) {
    return;
  }
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "") || undefined;
  } catch {
    return;
  }
};

export const toMobileCardSummary = (card: CardWithUrls) => {
  const fileName = card.fileMetadata?.fileName;
  const previewText = compactText(
    card.type === "audio" ? card.aiTranscript : card.content
  );
  const linkTitle =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview.title
      : undefined;
  const title =
    linkTitle ||
    card.metadataTitle ||
    fileName ||
    // A link's content is usually its URL; the site name reads better.
    (card.type === "link" ? linkHostname(card.url) : undefined) ||
    previewText?.split("\n", 1)[0] ||
    (card.type === "palette" ? "Color palette" : "Saved card");

  return {
    _creationTime: card._creationTime,
    _id: card._id,
    aspectRatio: mediaAspectRatio(card),
    colors: card.colors?.map((color) => color.hex),
    compactUrl: card.compactUrl,
    fileName,
    isFavorited: card.isFavorited || undefined,
    linkPreviewImageUrl: card.linkPreviewImageUrl,
    placeholderUrl: card.placeholderUrl,
    previewText,
    screenshotUrl: card.screenshotUrl,
    thumbnailUrl: card.thumbnailUrl,
    title,
    type: card.type,
    url: card.url,
  };
};

export const searchMobileCardSummariesPaginated = query({
  args: searchCardsPaginatedArgsValidator.fields,
  returns: paginationResultValidator,
  handler: async (ctx, args) => {
    const result = await searchCardsPaginatedHandler(ctx, args, {
      summariesOnly: true,
    });

    return {
      ...result,
      page: result.page.map(toMobileCardSummary),
    };
  },
});
