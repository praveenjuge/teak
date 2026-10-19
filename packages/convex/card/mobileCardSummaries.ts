import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardTypeValidator } from "../schema";
import { cardDisplayTitle, cardPreviewText } from "./displayTitle";
import {
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./getCards";
import { type CardWithUrls, linkPreviewImageFields } from "./queryUtils";

const mobileCardSummaryValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("cards"),
  aspectRatio: v.optional(v.number()),
  colors: v.optional(v.array(v.string())),
  compactUrl: v.optional(v.string()),
  fileName: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  ...linkPreviewImageFields,
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

const ratio = (width?: number, height?: number) =>
  width && height && width > 0 && height > 0 ? width / height : undefined;

const mediaAspectRatio = (card: CardWithUrls) => {
  if (card.type === "link") {
    const override = card.hasThumbnailOverride
      ? card.thumbnailOverride
      : undefined;
    if (override) {
      return ratio(override.width, override.height);
    }
    const preview = card.metadata?.linkPreview;
    return card.linkPreviewImageUrl
      ? ratio(preview?.imageWidth, preview?.imageHeight)
      : ratio(preview?.screenshotWidth, preview?.screenshotHeight);
  }
  return ratio(card.fileMetadata?.width, card.fileMetadata?.height);
};

export const toMobileCardSummary = (card: CardWithUrls) => {
  const fileName = card.fileMetadata?.fileName;
  const previewText = cardPreviewText(card);
  const title = cardDisplayTitle(card, previewText);

  return {
    _creationTime: card._creationTime,
    _id: card._id,
    aspectRatio: mediaAspectRatio(card),
    colors: card.colors?.map((color) => color.hex),
    compactUrl: card.compactUrl,
    fileName,
    hasThumbnailOverride: card.hasThumbnailOverride,
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
