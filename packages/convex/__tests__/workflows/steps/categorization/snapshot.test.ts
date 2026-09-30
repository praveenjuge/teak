import { expect, test } from "bun:test";
import { projectCategorizationSnapshot } from "../../../../workflows/steps/categorization/index";

test("categorization snapshots exclude unrelated customer fields without modifying the card", () => {
  const card = {
    _id: "card1",
    userId: "user1",
    type: "link",
    url: "https://example.com",
    content: "private ".repeat(10_000),
    notes: "notes",
    tags: ["user-tag"],
    aiTranscript: "transcript",
    metadata: {
      linkCategory: { category: "article", raw: { provider: "facts" } },
      linkPreview: {
        status: "success",
        title: "Title",
        imageUrl: "https://example.com/image.png",
        raw: [{ selector: "title" }],
        rawStorageKey: "key",
        rawSha256: "digest",
        media: [{ caption: "unneeded" }],
      },
    },
  };
  const before = structuredClone(card);
  const snapshot = projectCategorizationSnapshot(card as any);
  expect(snapshot.metadata.linkCategory).toEqual(card.metadata.linkCategory);
  expect(snapshot.metadata.linkPreview).toMatchObject({
    status: "success",
    title: "Title",
    raw: card.metadata.linkPreview.raw,
    rawStorageKey: "key",
    rawSha256: "digest",
  });
  expect(snapshot).not.toHaveProperty("content");
  expect(snapshot).not.toHaveProperty("notes");
  expect(snapshot.metadata.linkPreview).not.toHaveProperty("media");
  expect(JSON.stringify(snapshot).length).toBeLessThan(1024);
  expect(card).toEqual(before);
});
