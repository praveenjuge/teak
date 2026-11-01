import { useState } from "react";
import type { CardWithUrls, LinkPreviewMetadata } from "./types";

interface ImageSize {
  height: number;
  width: number;
}

export interface LinkCardImage {
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

export function successfulLinkPreview(
  card: Pick<CardWithUrls, "metadata">
): LinkPreviewMetadata | undefined {
  return card.metadata?.linkPreview?.status === "success"
    ? (card.metadata.linkPreview as LinkPreviewMetadata)
    : undefined;
}

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

export function useLinkCardImage(card: CardWithUrls): {
  image: LinkCardImage | undefined;
  onImageError: (failedUrl: string) => void;
} {
  const [useScreenshot, setUseScreenshot] = useState(false);
  const image =
    card.type === "link"
      ? resolveLinkCardImage(card, useScreenshot)
      : undefined;
  const screenshotUrl = stringOrUndefined(card.screenshotUrl);

  // When the screenshot fails too, the image shows its blank fallback.
  const onImageError = (failedUrl: string) => {
    if (!useScreenshot && screenshotUrl && failedUrl !== screenshotUrl) {
      setUseScreenshot(true);
    }
  };

  return { image, onImageError };
}
