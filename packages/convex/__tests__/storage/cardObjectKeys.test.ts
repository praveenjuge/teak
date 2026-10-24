import { describe, expect, test } from "bun:test";
import { cardStorageObjectKeys } from "../../storage/cardObjectKeys";

describe("cardStorageObjectKeys: saved pages", () => {
  test("includes a link's saved copy and the snapshot waiting to become one", () => {
    expect(
      cardStorageObjectKeys({
        metadata: { linkPreview: { screenshotStorageKey: "screenshot" } },
        pageArchive: { storageKey: "page-archive" },
        pendingPageSnapshotKey: "page-snapshot",
      })
    ).toEqual(["screenshot", "page-archive", "page-snapshot"]);
  });

  test("a link without either lists neither", () => {
    expect(
      cardStorageObjectKeys({
        metadata: { linkPreview: { screenshotStorageKey: "screenshot" } },
      })
    ).toEqual(["screenshot"]);
  });
});

describe("cardStorageObjectKeys: articles", () => {
  test("includes a link's article Markdown and every image it shows", () => {
    expect(
      cardStorageObjectKeys({
        article: {
          imageKeys: ["article-image-0", "article-image-1"],
          status: "ready",
          textKey: "article-text",
        },
        documentTextKey: "article-text",
        pageArchive: { storageKey: "page-archive" },
      })
    ).toEqual([
      "article-text",
      "page-archive",
      "article-image-0",
      "article-image-1",
    ]);
  });
});
