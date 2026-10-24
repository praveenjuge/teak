export const cardStorageObjectKeys = (card: {
  documentTextKey?: string;
  fileKey?: string;
  metadata?: {
    linkCategory?: { rawStorageKey?: string };
    linkPreview?: {
      rawStorageKey?: string;
      imageStorageKey?: string;
      media?: Array<{ posterStorageKey?: string; storageKey?: string }>;
      screenshotStorageKey?: string;
    };
  };
  pageArchive?: { storageKey?: string };
  pendingPageSnapshotKey?: string;
  previewKey?: string;
  previousThumbnailOverride?: { override?: { storageKey?: string } | null };
  scrubKey?: string;
  thumbnailKey?: string;
  thumbnailOverride?: { storageKey?: string };
  workflowArtifactKeys?: string[];
}): string[] => {
  const linkPreview = card.metadata?.linkPreview;
  return [
    card.fileKey,
    card.fileKey ? `${card.fileKey}.processing.json` : undefined,
    card.thumbnailKey,
    card.scrubKey,
    card.previewKey,
    card.documentTextKey,
    ...(card.workflowArtifactKeys ?? []),
    linkPreview?.rawStorageKey,
    card.metadata?.linkCategory?.rawStorageKey,
    linkPreview?.imageStorageKey,
    linkPreview?.screenshotStorageKey,
    ...(linkPreview?.media ?? []).flatMap((item) => [
      item.storageKey,
      item.posterStorageKey,
    ]),
    card.thumbnailOverride?.storageKey,
    card.previousThumbnailOverride?.override?.storageKey,
    card.pageArchive?.storageKey,
    card.pendingPageSnapshotKey,
  ].filter((key, index, keys): key is string =>
    Boolean(key && keys.indexOf(key) === index)
  );
};
