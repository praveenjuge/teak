import { describe, expect, mock, test } from "bun:test";
import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  applyBulkActionToCard,
  bulkActionCopy,
  collectCardLinks,
  runBulkInChunks,
} from "../bulkCardActions";

const card = (overrides: Partial<Doc<"cards">> = {}) =>
  ({
    _id: "card_1",
    _creationTime: 1,
    userId: "owner",
    type: "link",
    content: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as Doc<"cards">;

describe("runBulkInChunks", () => {
  test("sends 250 cards as three calls of at most 100, in order", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `c${index}`);
    const send = mock((chunk: string[]) =>
      Promise.resolve({ updatedIds: chunk, failedIds: [] })
    );
    const progress = mock();

    const result = await runBulkInChunks(ids, send, progress);

    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      100, 100, 50,
    ]);
    expect(progress.mock.calls).toEqual([
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
    expect(result).toEqual({ updatedIds: ids, failedIds: [] });
  });

  test("a chunk that fails outright counts its cards as failed and the rest still run", async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `c${index}`);
    let call = 0;
    const result = await runBulkInChunks(ids, (chunk) => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({
            updatedIds: chunk.slice(1),
            failedIds: [chunk[0] as string],
          });
    });

    expect(result.failedIds).toEqual([...ids.slice(0, 100), "c100"]);
    expect(result.updatedIds).toEqual(ids.slice(101));
  });

  test("repeated IDs are sent once", async () => {
    const send = mock((chunk: string[]) =>
      Promise.resolve({ updatedIds: chunk, failedIds: [] })
    );
    await runBulkInChunks(["a", "b", "a"], send);
    expect(send.mock.calls[0]?.[0]).toEqual(["a", "b"]);
  });
});

describe("bulkActionCopy", () => {
  test("says what happened in counts people can read", () => {
    expect(bulkActionCopy.progress("archive", 120, 300)).toBe(
      "Archiving 120 of 300…"
    );
    expect(bulkActionCopy.done("archive", 1)).toBe("Archived 1 card");
    expect(bulkActionCopy.partial("archive", 298, 2)).toBe(
      "Archived 298 cards. 2 couldn't be changed."
    );
    expect(bulkActionCopy.done("delete", 3)).toBe("Moved 3 cards to Trash");
    expect(bulkActionCopy.failed("addTags")).toBe(
      "Couldn't add tags to these cards"
    );
  });
});

describe("applyBulkActionToCard", () => {
  test("adds tags without repeating one that differs only in case", () => {
    const next = applyBulkActionToCard(
      card({ tags: ["Design"] }),
      "addTags",
      ["design", "Later"],
      5
    );
    expect(next.tags).toEqual(["Design", "Later"]);
    expect(next.updatedAt).toBe(5);
  });

  test("removes a tag whether the user or Teak added it", () => {
    const next = applyBulkActionToCard(
      card({ tags: ["Design", "Keep"], aiTags: ["design"] }),
      "removeTags",
      ["DESIGN"]
    );
    expect(next.tags).toEqual(["Keep"]);
    expect(next.aiTags).toBeUndefined();
  });

  test("archiving twice keeps the first archived date", () => {
    const archived = applyBulkActionToCard(card(), "archive", [], 10);
    expect(archived).toMatchObject({ isArchived: true, archivedAt: 10 });
    expect(applyBulkActionToCard(archived, "archive", [], 20).archivedAt).toBe(
      10
    );
    const back = applyBulkActionToCard(archived, "unarchive");
    expect(back.isArchived).toBeUndefined();
    expect(back.archivedAt).toBeUndefined();
  });
});

describe("collectCardLinks", () => {
  test("lists each link once and skips cards without one", () => {
    expect(
      collectCardLinks([
        card({ url: "https://a.example" }),
        card({ url: " https://a.example " }),
        card({ type: "text", url: undefined }),
        card({ url: "https://b.example" }),
      ])
    ).toEqual(["https://a.example", "https://b.example"]);
  });
});
