interface PrefetchableMedia {
  detailUrl?: string | null;
  fileUrl?: string | null;
  thumbnailUrl?: string | null;
  type?: string | null;
}

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
