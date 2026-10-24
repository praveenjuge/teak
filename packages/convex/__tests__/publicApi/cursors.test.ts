import { describe, expect, test } from "bun:test";

import type { Doc } from "../../_generated/dataModel";
import {
  decodeCursor,
  encodeCursor,
  listAnchorOf,
  matchAnchorOf,
} from "../../publicApi/cursors";

const encoded = (value: unknown) => btoa(JSON.stringify(value));

const card = (fields: Partial<Doc<"cards">>) =>
  ({
    _id: "card_1",
    _creationTime: 42,
    createdAt: 1000,
    ...fields,
  }) as Doc<"cards">;

describe("API cursor anchors", () => {
  test("anchor on the saved date, or createdAt for a card without one", () => {
    expect(listAnchorOf(card({ savedAt: 9000 }))).toEqual({
      creationTime: 42,
      savedAt: 9000,
    });
    expect(matchAnchorOf(card({ savedAt: 9000 }))).toEqual({
      id: "card_1",
      savedAt: 9000,
    });
    expect(listAnchorOf(card({}))).toEqual({ creationTime: 42, savedAt: 1000 });
  });

  test("a new cursor round-trips with its page", () => {
    const cursor = {
      mode: "list" as const,
      anchor: { creationTime: 42, savedAt: 9000 },
      page: "convex-page",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(
      decodeCursor(
        encodeCursor({ mode: "match", anchor: { id: "x", savedAt: 9000 } })
      )
    ).toEqual({ mode: "match", anchor: { id: "x", savedAt: 9000 } });
  });

  test("a cursor issued before the savedAt order reads its createdAt as the anchor", () => {
    expect(
      decodeCursor(
        encoded({ mode: "list", anchor: { createdAt: 1000, creationTime: 42 } })
      )
    ).toEqual({ mode: "list", anchor: { creationTime: 42, savedAt: 1000 } });
    expect(
      decodeCursor(
        encoded({ mode: "match", anchor: { createdAt: 1000, id: "x" } })
      )
    ).toEqual({ mode: "match", anchor: { id: "x", savedAt: 1000 } });
  });

  test("an old cursor drops its page, which belongs to the old index, and resumes from its anchor", () => {
    expect(
      decodeCursor(
        encoded({
          mode: "list",
          anchor: { createdAt: 1000, creationTime: 42 },
          page: "created-index-page",
        })
      )
    ).toEqual({ mode: "list", anchor: { creationTime: 42, savedAt: 1000 } });
  });

  test("an anchor without a date is still refused", () => {
    expect(() =>
      decodeCursor(encoded({ mode: "list", anchor: { creationTime: 42 } }))
    ).toThrow("`cursor` is invalid");
    expect(() =>
      decodeCursor(encoded({ mode: "match", anchor: { id: "x" } }))
    ).toThrow("`cursor` is invalid");
  });
});
