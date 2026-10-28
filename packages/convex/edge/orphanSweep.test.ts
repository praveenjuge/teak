import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { cardStorageObjectKeys } from "../storage/cardObjectKeys";

const modules = import.meta.glob("../**/*.ts");

test("the sweep's card page holds every object the card keeps", async () => {
  const t = convexTest(schema, modules);
  const prefix = "users/abc/cards/card_1";
  const keys = {
    fileKey: `${prefix}/file/doc.pdf`,
    documentTextKey: `${prefix}/document-text/text.txt`,
    pageArchive: `${prefix}/page-archive/page.html`,
    pendingPageSnapshotKey: `${prefix}/page-snapshot/pending.html`,
    articleText: `${prefix}/article-text/a.md`,
    articleImage: `${prefix}/article-image/1.webp`,
  };
  const now = Date.now();
  const cardId = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "sweep-owner",
      type: "link",
      content: "",
      url: "https://example.com",
      fileKey: keys.fileKey,
      documentTextKey: keys.documentTextKey,
      pageArchive: {
        storageKey: keys.pageArchive,
        bytes: 10,
        kind: "full",
        source: "server",
        capturedAt: now,
        sourceUrl: "https://example.com",
      },
      pendingPageSnapshotKey: keys.pendingPageSnapshotKey,
      article: {
        status: "ready",
        textKey: keys.articleText,
        imageKeys: [keys.articleImage],
        wordCount: 10,
        readingMinutes: 1,
        extractedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    })
  );
  const stored = await t.run((ctx) => ctx.db.get("cards", cardId));
  if (!stored) {
    throw new Error("card missing");
  }

  const page = await t.query(internal.storage.orphanSweep.pageSweepCards, {
    numItems: 10,
  });
  expect(page.cards).toHaveLength(1);
  const referenced = cardStorageObjectKeys(page.cards[0]);
  expect(referenced.sort()).toEqual(cardStorageObjectKeys(stored).sort());
  for (const key of Object.values(keys)) {
    expect(referenced).toContain(key);
  }
});
