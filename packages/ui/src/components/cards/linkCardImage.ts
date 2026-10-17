import { type SyntheticEvent, useState } from "react";
import type { CardWithUrls, LinkPreviewMetadata } from "./types";

interface ImageSize {
  height: number;
  width: number;
}

/** The image a link tile shows, with its stored size when one is known. */
export interface LinkCardImage {
  /** Missing for older or partial metadata; the tile then has a fixed height. */
  size?: ImageSize;
  src: string;
  storageKey?: string;
}

const sizeOf = (width: unknown, height: unknown): ImageSize | undefined =>
  typeof width === "number" && typeof height === "number"
    ? { width, height }
    : undefined;

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The link preview the server scraped, when the scrape succeeded. */
export function successfulLinkPreview(
  card: Pick<CardWithUrls, "metadata">
): LinkPreviewMetadata | undefined {
  return card.metadata?.linkPreview?.status === "success"
    ? (card.metadata.linkPreview as LinkPreviewMetadata)
    : undefined;
}

/**
 * Which image a link card shows. An image someone chose comes first, then
 * attached media (an X post's image or video poster), then the page's own
 * preview image; the page screenshot stands in when there is none or it
 * failed to load (`useScreenshot`). An image whose size is known wins over
 * one whose size is not, which older and partial metadata can leave out.
 */
export function resolveLinkCardImage(
  card: CardWithUrls,
  useScreenshot: boolean
): LinkCardImage | undefined {
  const linkPreview = successfulLinkPreview(card);
  const storedPreview = card.metadata?.linkPreview;
  const storedLinkMedia = Array.isArray(storedPreview?.media)
    ? (storedPreview.media as Record<string, unknown>[])
    : [];
  const thumbnailOverride = card.hasThumbnailOverride
    ? card.thumbnailOverride
    : undefined;

  const attachedMedia = thumbnailOverride
    ? undefined
    : (card.linkPreviewMedia?.find((item) => item.type === "image") ??
      card.linkPreviewMedia?.find(
        (item) => item.type === "video" && typeof item.posterUrl === "string"
      ));
  const primaryUrl =
    attachedMedia?.type === "image"
      ? attachedMedia.url
      : (attachedMedia?.posterUrl ?? card.linkPreviewImageUrl);

  const storedMedia = thumbnailOverride
    ? undefined
    : (storedLinkMedia.find((item) => item.type === "image") ??
      storedLinkMedia.find(
        (item) =>
          item.type === "video" && typeof item.posterStorageKey === "string"
      ));
  const primaryKey =
    thumbnailOverride?.storageKey ??
    (storedMedia?.type === "image"
      ? storedMedia.storageKey
      : (storedMedia?.posterStorageKey ?? storedPreview?.imageStorageKey));

  const attachedSize =
    attachedMedia?.type === "image"
      ? sizeOf(attachedMedia.width, attachedMedia.height)
      : sizeOf(attachedMedia?.posterWidth, attachedMedia?.posterHeight);
  const previewSize = thumbnailOverride
    ? { width: thumbnailOverride.width, height: thumbnailOverride.height }
    : sizeOf(linkPreview?.imageWidth, linkPreview?.imageHeight);

  const primary: LinkCardImage | undefined = primaryUrl
    ? {
        size: attachedSize ?? previewSize,
        src: primaryUrl,
        storageKey: stringOrUndefined(primaryKey),
      }
    : undefined;
  const screenshotUrl = stringOrUndefined(card.screenshotUrl);
  const screenshot: LinkCardImage | undefined = screenshotUrl
    ? {
        size: sizeOf(
          linkPreview?.screenshotWidth,
          linkPreview?.screenshotHeight
        ),
        src: screenshotUrl,
        storageKey: stringOrUndefined(storedPreview?.screenshotStorageKey),
      }
    : undefined;

  if (!useScreenshot && primary?.size) {
    return primary;
  }
  if (screenshot?.size) {
    return screenshot;
  }
  return useScreenshot ? screenshot : (primary ?? screenshot);
}

/**
 * A link card's image, switching to the page screenshot when the preferred
 * image fails to load, and hiding an image that has nothing to fall back to.
 */
export function useLinkCardImage(card: CardWithUrls): {
  image: LinkCardImage | undefined;
  onImageError: (event: SyntheticEvent<HTMLImageElement>) => void;
} {
  const [useScreenshot, setUseScreenshot] = useState(false);
  const image =
    card.type === "link"
      ? resolveLinkCardImage(card, useScreenshot)
      : undefined;
  const screenshotUrl = stringOrUndefined(card.screenshotUrl);

  const onImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    if (!useScreenshot && screenshotUrl && target.src !== screenshotUrl) {
      setUseScreenshot(true);
    } else {
      target.style.display = "none";
    }
  };

  return { image, onImageError };
}
