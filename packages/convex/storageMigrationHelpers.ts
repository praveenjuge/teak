import type { Doc } from "./_generated/dataModel";
import { isR2StorageRef, type StorageRef } from "./storageRefs";

export const storageMigrationKindLiterals = [
  "uploads",
  "thumbnails",
  "screenshots",
  "link-previews",
  "media",
  "posters",
] as const;

export type StorageMigrationKind =
  (typeof storageMigrationKindLiterals)[number];

export type LegacyStorageAssetCandidate = {
  contentType?: string;
  fieldPath: string;
  fileName?: string;
  kind: StorageMigrationKind;
  legacyRef: StorageRef;
};

export type AppliedStorageMigration = LegacyStorageAssetCandidate & {
  r2Ref: StorageRef;
};

const mediaFieldPathMatcher =
  /^metadata\.linkPreview\.media\.(\d+)\.(storageId|posterStorageId)$/;

export const getStorageRefAtFieldPath = (
  card: Doc<"cards">,
  fieldPath: string
): StorageRef | null => {
  if (fieldPath === "fileId") {
    return card.fileId ?? null;
  }

  if (fieldPath === "thumbnailId") {
    return card.thumbnailId ?? null;
  }

  if (fieldPath === "metadata.linkPreview.imageStorageId") {
    return card.metadata?.linkPreview?.imageStorageId ?? null;
  }

  if (fieldPath === "metadata.linkPreview.screenshotStorageId") {
    return card.metadata?.linkPreview?.screenshotStorageId ?? null;
  }

  const mediaMatch = fieldPath.match(mediaFieldPathMatcher);
  if (!mediaMatch) {
    return null;
  }

  const mediaIndex = Number.parseInt(mediaMatch[1] ?? "", 10);
  const mediaField = mediaMatch[2];
  const mediaItem = card.metadata?.linkPreview?.media?.[mediaIndex];

  if (!mediaItem) {
    return null;
  }

  return mediaField === "storageId"
    ? mediaItem.storageId
    : (mediaItem.posterStorageId ?? null);
};

export const collectLegacyStorageRefs = (
  card: Doc<"cards">
): LegacyStorageAssetCandidate[] => {
  const candidates: LegacyStorageAssetCandidate[] = [];

  if (card.fileId && !isR2StorageRef(card.fileId)) {
    candidates.push({
      contentType: card.fileMetadata?.mimeType,
      fieldPath: "fileId",
      fileName: card.fileMetadata?.fileName,
      kind: "uploads",
      legacyRef: card.fileId,
    });
  }

  if (card.thumbnailId && !isR2StorageRef(card.thumbnailId)) {
    candidates.push({
      fieldPath: "thumbnailId",
      kind: "thumbnails",
      legacyRef: card.thumbnailId,
    });
  }

  const linkPreview = card.metadata?.linkPreview;

  if (
    linkPreview?.imageStorageId &&
    !isR2StorageRef(linkPreview.imageStorageId)
  ) {
    candidates.push({
      fieldPath: "metadata.linkPreview.imageStorageId",
      kind: "link-previews",
      legacyRef: linkPreview.imageStorageId,
    });
  }

  if (
    linkPreview?.screenshotStorageId &&
    !isR2StorageRef(linkPreview.screenshotStorageId)
  ) {
    candidates.push({
      fieldPath: "metadata.linkPreview.screenshotStorageId",
      kind: "screenshots",
      legacyRef: linkPreview.screenshotStorageId,
    });
  }

  linkPreview?.media?.forEach((mediaItem, index) => {
    if (!isR2StorageRef(mediaItem.storageId)) {
      candidates.push({
        contentType: mediaItem.contentType,
        fieldPath: `metadata.linkPreview.media.${index}.storageId`,
        kind: "media",
        legacyRef: mediaItem.storageId,
      });
    }

    if (
      mediaItem.posterStorageId &&
      !isR2StorageRef(mediaItem.posterStorageId)
    ) {
      candidates.push({
        contentType: mediaItem.posterContentType,
        fieldPath: `metadata.linkPreview.media.${index}.posterStorageId`,
        kind: "posters",
        legacyRef: mediaItem.posterStorageId,
      });
    }
  });

  return candidates;
};

export const applyStorageMigrationPatch = (
  card: Doc<"cards">,
  migrations: AppliedStorageMigration[]
) => {
  let nextMetadata = card.metadata;
  let metadataCloned = false;
  let linkPreviewCloned = false;
  let mediaCloned = false;
  let changed = false;
  const applied: AppliedStorageMigration[] = [];
  const patch: Partial<Doc<"cards">> = {};

  const ensureLinkPreview = () => {
    if (!nextMetadata?.linkPreview) {
      return null;
    }

    if (!metadataCloned) {
      nextMetadata = { ...nextMetadata };
      metadataCloned = true;
    }

    if (!linkPreviewCloned) {
      nextMetadata.linkPreview = { ...nextMetadata.linkPreview };
      linkPreviewCloned = true;
    }

    return nextMetadata.linkPreview;
  };

  const ensureMediaItem = (index: number) => {
    const linkPreview = ensureLinkPreview();
    if (!linkPreview?.media?.[index]) {
      return null;
    }

    if (!mediaCloned) {
      linkPreview.media = [...linkPreview.media];
      mediaCloned = true;
    }

    const existingItem = linkPreview.media[index];
    linkPreview.media[index] = { ...existingItem };
    return linkPreview.media[index];
  };

  for (const migration of migrations) {
    if (migration.fieldPath === "fileId") {
      if (card.fileId === migration.legacyRef) {
        patch.fileId = migration.r2Ref;
        applied.push(migration);
        changed = true;
      }
      continue;
    }

    if (migration.fieldPath === "thumbnailId") {
      if (card.thumbnailId === migration.legacyRef) {
        patch.thumbnailId = migration.r2Ref;
        applied.push(migration);
        changed = true;
      }
      continue;
    }

    if (migration.fieldPath === "metadata.linkPreview.imageStorageId") {
      const linkPreview = ensureLinkPreview();
      if (linkPreview?.imageStorageId === migration.legacyRef) {
        linkPreview.imageStorageId = migration.r2Ref;
        applied.push(migration);
        changed = true;
      }
      continue;
    }

    if (migration.fieldPath === "metadata.linkPreview.screenshotStorageId") {
      const linkPreview = ensureLinkPreview();
      if (linkPreview?.screenshotStorageId === migration.legacyRef) {
        linkPreview.screenshotStorageId = migration.r2Ref;
        applied.push(migration);
        changed = true;
      }
      continue;
    }

    const mediaMatch = migration.fieldPath.match(mediaFieldPathMatcher);
    if (!mediaMatch) {
      continue;
    }

    const mediaIndex = Number.parseInt(mediaMatch[1] ?? "", 10);
    const mediaField = mediaMatch[2];
    const mediaItem = ensureMediaItem(mediaIndex);

    if (!mediaItem) {
      continue;
    }

    if (
      mediaField === "storageId" &&
      mediaItem.storageId === migration.legacyRef
    ) {
      mediaItem.storageId = migration.r2Ref;
      applied.push(migration);
      changed = true;
      continue;
    }

    if (
      mediaField === "posterStorageId" &&
      mediaItem.posterStorageId === migration.legacyRef
    ) {
      mediaItem.posterStorageId = migration.r2Ref;
      applied.push(migration);
      changed = true;
    }
  }

  if (changed && nextMetadata) {
    patch.metadata = nextMetadata;
  }

  return {
    applied,
    changed,
    patch,
  };
};
