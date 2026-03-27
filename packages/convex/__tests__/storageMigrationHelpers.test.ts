import { describe, expect, test } from "bun:test";
import {
  applyStorageMigrationPatch,
  collectLegacyStorageRefs,
  getStorageRefAtFieldPath,
} from "../storageMigrationHelpers";

const buildCard = () =>
  ({
    _creationTime: Date.now(),
    _id: "card_1",
    content: "Example",
    createdAt: Date.now(),
    fileId: "legacy-file",
    fileMetadata: {
      fileName: "photo.png",
      fileSize: 100,
      mimeType: "image/png",
    },
    isDeleted: false,
    metadata: {
      linkPreview: {
        fetchedAt: Date.now(),
        imageStorageId: "legacy-preview",
        media: [
          {
            contentType: "video/mp4",
            posterContentType: "image/jpeg",
            posterStorageId: "legacy-poster",
            storageId: "r2:dev/media/already-migrated.mp4",
            type: "video",
            updatedAt: Date.now(),
          },
          {
            contentType: "image/jpeg",
            storageId: "legacy-media",
            type: "image",
            updatedAt: Date.now(),
          },
        ],
        screenshotStorageId: "legacy-shot",
        source: "kernel_playwright",
        status: "success",
        url: "https://example.com",
      },
    },
    metadataStatus: "completed",
    processingStatus: {},
    thumbnailId: "legacy-thumb",
    type: "image",
    updatedAt: Date.now(),
    url: undefined,
    userId: "user_1",
  }) as any;

describe("storageMigrationHelpers", () => {
  test("collectLegacyStorageRefs returns only non-R2 refs", () => {
    const card = buildCard();

    expect(collectLegacyStorageRefs(card)).toEqual([
      {
        contentType: "image/png",
        fieldPath: "fileId",
        fileName: "photo.png",
        kind: "uploads",
        legacyRef: "legacy-file",
      },
      {
        fieldPath: "thumbnailId",
        kind: "thumbnails",
        legacyRef: "legacy-thumb",
      },
      {
        fieldPath: "metadata.linkPreview.imageStorageId",
        kind: "link-previews",
        legacyRef: "legacy-preview",
      },
      {
        fieldPath: "metadata.linkPreview.screenshotStorageId",
        kind: "screenshots",
        legacyRef: "legacy-shot",
      },
      {
        contentType: "image/jpeg",
        fieldPath: "metadata.linkPreview.media.0.posterStorageId",
        kind: "posters",
        legacyRef: "legacy-poster",
      },
      {
        contentType: "image/jpeg",
        fieldPath: "metadata.linkPreview.media.1.storageId",
        kind: "media",
        legacyRef: "legacy-media",
      },
    ]);
  });

  test("applyStorageMigrationPatch updates matching nested refs", () => {
    const card = buildCard();
    const result = applyStorageMigrationPatch(card, [
      {
        fieldPath: "fileId",
        kind: "uploads",
        legacyRef: "legacy-file",
        r2Ref: "r2:dev/uploads/u/file.png",
      },
      {
        fieldPath: "metadata.linkPreview.media.1.storageId",
        kind: "media",
        legacyRef: "legacy-media",
        r2Ref: "r2:dev/media/u/file.jpg",
      },
      {
        fieldPath: "metadata.linkPreview.screenshotStorageId",
        kind: "screenshots",
        legacyRef: "legacy-shot",
        r2Ref: "r2:dev/screenshots/u/file.png",
      },
    ] as any);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(3);
    expect(result.patch.fileId).toBe("r2:dev/uploads/u/file.png");
    expect(result.patch.metadata?.linkPreview?.screenshotStorageId).toBe(
      "r2:dev/screenshots/u/file.png"
    );
    expect(result.patch.metadata?.linkPreview?.media?.[1]?.storageId).toBe(
      "r2:dev/media/u/file.jpg"
    );
  });

  test("getStorageRefAtFieldPath resolves media poster refs", () => {
    const card = buildCard();

    expect(getStorageRefAtFieldPath(card, "thumbnailId")).toBe("legacy-thumb");
    expect(
      getStorageRefAtFieldPath(
        card,
        "metadata.linkPreview.media.0.posterStorageId"
      )
    ).toBe("legacy-poster");
    expect(
      getStorageRefAtFieldPath(card, "metadata.linkPreview.media.9.storageId")
    ).toBe(null);
  });
});
