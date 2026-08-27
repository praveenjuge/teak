// Warm the browser cache with the URLs a card's modal view will request, so
// opening the modal feels instant. Called from grid cards on pointer enter;
// each URL is fetched at most once per page session.

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

interface PrefetchableMedia {
  detailUrl?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  type?: string | null;
}

/**
 * Prefetch the media the card modal will render. Image cards load their full
 * file in the modal, so that is what gets warmed; videos only warm their
 * poster thumbnail since the clip itself should keep streaming on demand.
 */
export const prefetchCardModalMedia = (card: PrefetchableMedia): void => {
  if (card.type === "image") {
    warmImage(card.detailUrl ?? card.thumbnailUrl);
    return;
  }
  if (card.type === "video") {
    warmImage(card.thumbnailUrl);
  }
};
