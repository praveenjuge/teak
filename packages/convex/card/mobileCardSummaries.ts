import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardTypeValidator } from "../schema";
import {
  searchCardsPaginatedArgsValidator,
  searchCardsPaginatedHandler,
} from "./getCards";
import type { CardWithUrls } from "./queryUtils";

const CONTENT_PREVIEW_LENGTH = 280;

const mobileCardSummaryValidator = v.object({
  _creationTime: v.number(),
  _id: v.id("cards"),
  colors: v.optional(v.array(v.string())),
  compactUrl: v.optional(v.string()),
  fileName: v.optional(v.string()),
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
    previewText?.split("\n", 1)[0] ||
    (card.type === "palette" ? "Color palette" : "Saved card");

  return {
    _creationTime: card._creationTime,
    _id: card._id,
    colors: card.colors?.map((color) => color.hex),
    compactUrl: card.compactUrl,
    fileName,
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
