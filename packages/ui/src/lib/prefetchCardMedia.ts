interface PrefetchableMedia {
  detailUrl?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  type?: string | null;
}

/**
 * Prefetch the media the card modal will render, each URL at most once per
 * prefetcher. Image cards warm the detail rendition (or the thumbnail when
 * there is none); videos only warm their poster thumbnail since the clip
 * itself should keep streaming on demand.
 */
export function createMediaPrefetcher() {
  const prefetchedUrls = new Set<string>();
  const warmImage = (url: string | null | undefined): void => {
    if (!url || prefetchedUrls.has(url)) {
      return;
    }
    prefetchedUrls.add(url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  };
  return (card: PrefetchableMedia): void => {
    if (card.type === "image") {
      warmImage(card.detailUrl ?? card.thumbnailUrl);
      return;
    }
    if (card.type === "video") {
      warmImage(card.thumbnailUrl);
    }
  };
}

export const prefetchCardModalMedia = createMediaPrefetcher();
