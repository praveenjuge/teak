import { describe, expect, mock, test } from "bun:test";
import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  bulkActionCopy,
  collectCardLinks,
  folderUndoSteps,
  runBulkInChunks,
} from "../bulkCardActions";
import { applyBulkActionToCard } from "../cardQueryOptimisticUpdates";
import { englishTranslator } from "../englishTranslators";

const bulkT = englishTranslator("lib.bulkCardActions");

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

    const result = await runBulkInChunks(ids, send, { onProgress: progress });

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
    const onError = mock((_error: unknown) => undefined);
    const result = await runBulkInChunks(
      ids,
      (chunk) => {
        call += 1;
        return call === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({
              updatedIds: chunk.slice(1),
              failedIds: [chunk[0] as string],
            });
      },
      { onError }
    );

    expect(onError).toHaveBeenCalledTimes(1);
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
    expect(bulkActionCopy.progress("archive", 120, 300, bulkT)).toBe(
      "Archiving 120 of 300…"
    );
    expect(bulkActionCopy.done("archive", 1, undefined, bulkT)).toBe(
      "Archived 1 card"
    );
    expect(bulkActionCopy.partial("archive", 298, 2, undefined, bulkT)).toBe(
      "Archived 298 cards. 2 couldn't be changed."
    );
    expect(bulkActionCopy.done("delete", 3, undefined, bulkT)).toBe(
      "Moved 3 cards to Trash"
    );
    expect(bulkActionCopy.failed("addTags", bulkT)).toBe(
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

  test("adding a hidden tag in bulk hides the card at once, as one edit does", () => {
    const next = applyBulkActionToCard(card(), "addTags", ["Secret"], 5);
    expect(next).toMatchObject({ isHidden: true, tags: ["Secret"] });
  });

  test("moving a pinned card to Trash or Archive unpins it, as the server does", () => {
    const pinned = card({ pinPosition: 1 });
    expect(
      applyBulkActionToCard(pinned, "delete", [], 5).pinPosition
    ).toBeUndefined();
    expect(
      applyBulkActionToCard(pinned, "archive", [], 5).pinPosition
    ).toBeUndefined();
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

describe("folder bulk actions", () => {
  test("add keeps the card's other folders and does not repeat one", () => {
    const inA = card({ folderIds: ["a"] as never });
    expect(
      applyBulkActionToCard(inA, "addToFolder", [], 5, { folderId: "b" })
        .folderIds
    ).toEqual(["a", "b"] as never);
    expect(
      applyBulkActionToCard(inA, "addToFolder", [], 5, { folderId: "a" })
    ).toBe(inA);
  });

  test("remove clears the field when the last folder goes", () => {
    const inA = card({ folderIds: ["a"] as never });
    const removed = applyBulkActionToCard(inA, "removeFromFolder", [], 5, {
      folderId: "a",
    });
    expect(removed.folderIds).toBeUndefined();
    expect(removed.updatedAt).toBe(5);
  });

  test("move leaves only the source folder", () => {
    const inAB = card({ folderIds: ["a", "b"] as never });
    expect(
      applyBulkActionToCard(inAB, "moveToFolder", [], 5, {
        folderId: "c",
        fromFolderId: "a",
      }).folderIds
    ).toEqual(["b", "c"] as never);
  });

  test("Undo of an add leaves cards that were already in the folder", () => {
    const before = new Map([
      ["c1", []],
      ["c2", ["r"]],
    ]);
    expect(
      folderUndoSteps(
        "addToFolder",
        { folderId: "r", folderName: "Reading" },
        ["c1", "c2"],
        before
      )
    ).toEqual([
      {
        action: "removeFromFolder",
        cardIds: ["c1"],
        folder: { folderId: "r", folderName: "Reading" },
      },
    ]);
  });

  test("Undo of a move puts back the source and keeps an earlier destination", () => {
    const before = new Map([
      ["c1", ["a"]],
      ["c2", ["a", "c"]],
    ]);
    expect(
      folderUndoSteps(
        "moveToFolder",
        {
          folderId: "c",
          folderName: "C",
          fromFolderId: "a",
          fromFolderName: "A",
        },
        ["c1", "c2"],
        before
      )
    ).toEqual([
      {
        action: "removeFromFolder",
        cardIds: ["c1"],
        folder: { folderId: "c", folderName: "C" },
      },
      {
        action: "addToFolder",
        cardIds: ["c1", "c2"],
        folder: { folderId: "a", folderName: "A" },
      },
    ]);
  });

  test("a move out of every folder offers no Undo", () => {
    expect(
      folderUndoSteps(
        "moveToFolder",
        { folderId: "c", folderName: "C" },
        ["c1"],
        new Map()
      )
    ).toBeUndefined();
  });

  test("toasts name the folder", () => {
    expect(bulkActionCopy.done("addToFolder", 3, "Reading", bulkT)).toBe(
      "Added 3 cards to Reading"
    );
    expect(bulkActionCopy.partial("moveToFolder", 2, 1, "Later", bulkT)).toBe(
      "Moved 2 cards to Later. 1 couldn't be changed."
    );
  });

  test("toasts shorten a very long folder name", () => {
    const message = bulkActionCopy.done(
      "addToFolder",
      1,
      "M".repeat(300),
      bulkT
    );
    expect(message.length).toBeLessThan(60);
    expect(message.endsWith("…")).toBe(true);
  });
});
