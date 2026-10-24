import { env } from "../../_generated/server";
import type { CardLinks } from "../../card/cardLinks";
import type { CardWithUrls } from "../../card/queryUtils";
import {
  isLocalDevelopmentHostname,
  resolveTeakDevAppUrl,
} from "../../devUrls";
import { readIsDevDeployment } from "../../env";
import { isLinkPrice } from "../../shared/price";
import { isCardHidden } from "../../shared/tags";
import type { CardListInclude } from "./shared";

const APP_PROD_URL = "https://app.teakvault.com";

export const getAppBaseUrl = (requestUrl: string): string => {
  const { hostname } = new URL(requestUrl);
  return isLocalDevelopmentHostname(hostname) || readIsDevDeployment()
    ? resolveTeakDevAppUrl(env)
    : APP_PROD_URL;
};

const getCardAppUrl = (requestUrl: string, cardId: string): string => {
  const appUrl = new URL(getAppBaseUrl(requestUrl));
  appUrl.searchParams.set("card", cardId);
  return appUrl.toString();
};

const serializeLinkPrice = (price: unknown) =>
  isLinkPrice(price)
    ? { amount: price.amount, currency: price.currency ?? null }
    : null;

/**
 * A link's saved copy: what it is, never where. The HTML stays in the app.
 */
const serializeArchive = (card: CardWithUrls) =>
  card.pageArchive
    ? {
        bytes: card.pageArchive.bytes,
        capturedAt: card.pageArchive.capturedAt,
        kind: card.pageArchive.kind,
      }
    : null;

const serializeDisplayMetadata = (card: CardWithUrls) => ({
  audioWaveform: card.fileMetadata?.waveform ?? null,
  isDeleted: Boolean(card.isDeleted),
  linkPreviewDescription: card.metadata?.linkPreview?.description ?? null,
  linkFacts:
    card.metadata?.linkCategory?.facts?.map(
      (fact: { label: string; value: string }) => ({
        label: fact.label,
        value: fact.value,
      })
    ) ?? [],
  linkPreviewTitle: card.metadata?.linkPreview?.title ?? null,
  linkCategory: card.metadata?.linkCategory?.category ?? null,
  linkPrice: serializeLinkPrice(card.metadata?.linkCategory?.price),
  linkFaviconUrl: card.metadata?.linkPreview?.faviconUrl ?? null,
  fileWidth: card.fileMetadata?.width ?? null,
  fileHeight: card.fileMetadata?.height ?? null,
  colors:
    card.colors?.map((color: { hex: string; name?: string }) => ({
      hex: color.hex,
      ...(color.name ? { name: color.name } : {}),
    })) ?? [],
  linkAuthor: card.metadata?.linkPreview?.author ?? null,
  linkPreviewMedia: card.linkPreviewMedia ?? [],
  linkPublishedAt: card.metadata?.linkPreview?.publishedAt ?? null,
  linkPublisher: card.metadata?.linkPreview?.publisher ?? null,
  linkSiteName: card.metadata?.linkPreview?.siteName ?? null,
  videoScrub:
    card.scrubUrl && card.fileMetadata?.scrub
      ? {
          frameHeight: card.fileMetadata.scrub.frameHeight,
          frameWidth: card.fileMetadata.scrub.frameWidth,
          frames: card.fileMetadata.scrub.frames,
          url: card.scrubUrl,
        }
      : null,
});

/**
 * A card as the public API returns it. `links` (its `[[…]]` links and the
 * cards linking to it) is given only for single-card responses; lists and
 * the changes feed leave both arrays out.
 */
export const serializeCard = (
  card: CardWithUrls,
  requestUrl: string,
  links?: CardLinks
) => ({
  aiSummary: card.aiSummary ?? null,
  aiTags: card.aiTags ?? [],
  aiTranscript: card.aiTranscript ?? null,
  appUrl: getCardAppUrl(requestUrl, card._id),
  archive: serializeArchive(card),
  compactUrl: card.compactUrl ?? null,
  content: card.content,
  ...serializeDisplayMetadata(card),
  createdAt: card.createdAt,
  detailUrl: card.detailUrl ?? null,
  fileUrl: card.fileUrl ?? null,
  fileExtension: card.fileMetadata?.extension ?? null,
  fileKind: card.fileMetadata?.kind ?? null,
  fileLanguage: card.fileMetadata?.language ?? null,
  fileName: card.fileMetadata?.fileName ?? null,
  filePreview: card.fileMetadata?.preview ?? null,
  fileSize: card.fileMetadata?.fileSize ?? null,
  id: card._id,
  archivedAt: card.archivedAt ?? null,
  completedAt: card.completedAt ?? null,
  folderIds: card.folderIds ?? [],
  isArchived: Boolean(card.isArchived),
  isFavorited: Boolean(card.isFavorited),
  isHidden: isCardHidden(card),
  linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
  metadataDescription: card.metadataDescription ?? null,
  metadataStatus: card.metadataStatus ?? null,
  metadataTitle: card.metadataTitle ?? null,
  mimeType: card.fileMetadata?.mimeType ?? null,
  notes: card.notes ?? null,
  processingStatus: card.processingStatus ?? null,
  savedAt: card.savedAt ?? card.createdAt,
  screenshotUrl: card.screenshotUrl ?? null,
  sourceTitle: card.sourceTitle ?? null,
  sourceUrl: card.sourceUrl ?? null,
  tags: card.tags ?? [],
  placeholderUrl: card.placeholderUrl ?? null,
  thumbnailUrl: card.thumbnailUrl ?? null,
  thumbnailOverridden: Boolean(card.thumbnailOverride),
  type: card.type,
  updatedAt: card.updatedAt,
  url: card.url ?? null,
  ...(links ?? {}),
});

export const serializeListCard = (
  card: CardWithUrls,
  requestUrl: string,
  include: Set<CardListInclude>
) => {
  const base = {
    aiTags: card.aiTags ?? [],
    appUrl: getCardAppUrl(requestUrl, card._id),
    completedAt: card.completedAt ?? null,
    createdAt: card.createdAt,
    folderIds: card.folderIds ?? [],
    id: card._id,
    isArchived: Boolean(card.isArchived),
    isFavorited: Boolean(card.isFavorited),
    isHidden: isCardHidden(card),
    metadataDescription: card.metadataDescription ?? null,
    metadataTitle: card.metadataTitle ?? null,
    savedAt: card.savedAt ?? card.createdAt,
    sourceTitle: card.sourceTitle ?? null,
    sourceUrl: card.sourceUrl ?? null,
    tags: card.tags ?? [],
    type: card.type,
    updatedAt: card.updatedAt,
    url: card.url ?? null,
  };

  return {
    ...base,
    ...(include.has("content")
      ? {
          aiSummary: card.aiSummary ?? null,
          content: card.content,
          notes: card.notes ?? null,
        }
      : {}),
    ...(include.has("metadata")
      ? {
          fileName: card.fileMetadata?.fileName ?? null,
          fileSize: card.fileMetadata?.fileSize ?? null,
          mimeType: card.fileMetadata?.mimeType ?? null,
          fileExtension: card.fileMetadata?.extension ?? null,
          fileKind: card.fileMetadata?.kind ?? null,
          fileLanguage: card.fileMetadata?.language ?? null,
          filePreview: card.fileMetadata?.preview ?? null,
          ...serializeDisplayMetadata(card),
          archive: serializeArchive(card),
          compactUrl: card.compactUrl ?? null,
          detailUrl: card.detailUrl ?? null,
          fileUrl: card.fileUrl ?? null,
          linkPreviewImageUrl: card.linkPreviewImageUrl ?? null,
          placeholderUrl: card.placeholderUrl ?? null,
          screenshotUrl: card.screenshotUrl ?? null,
          thumbnailOverridden: Boolean(card.thumbnailOverride),
          thumbnailUrl: card.thumbnailUrl ?? null,
        }
      : {}),
    ...(include.has("processing")
      ? {
          aiTranscript: card.aiTranscript ?? null,
          metadataStatus: card.metadataStatus ?? null,
          processingStatus: card.processingStatus ?? null,
        }
      : {}),
  };
};

export const buildCreateCardResponse = (
  result: {
    card?: CardWithUrls;
    cardId: string;
    resaved?: true;
    status: "created";
    wasArchived?: true;
  },
  requestUrl: string,
  links?: CardLinks
) => {
  const card = result.card
    ? serializeCard(result.card, requestUrl, links)
    : undefined;
  return {
    appUrl: getCardAppUrl(requestUrl, result.cardId),
    card,
    cardId: result.cardId,
    status: result.status,
    ...(result.resaved ? { resaved: true as const } : {}),
    ...(result.wasArchived ? { wasArchived: true as const } : {}),
  };
};

export const serializeFolder = (folder: {
  _id: string;
  activeCardCount: number;
  color?: string;
  createdAt: number;
  kind: string;
  name: string;
  query?: string;
  updatedAt: number;
}) => ({
  id: folder._id,
  name: folder.name,
  color: folder.color ?? null,
  kind: folder.kind,
  query: folder.kind === "smart" ? (folder.query ?? "") : null,
  cardCount: folder.kind === "smart" ? null : folder.activeCardCount,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});
