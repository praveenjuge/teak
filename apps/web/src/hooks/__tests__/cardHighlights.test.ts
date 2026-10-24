import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import {
  type CardHighlight,
  createPendingHighlightIds,
  highlightProblem,
  optimisticHighlightId,
  undoRemovalInput,
  withNewHighlight,
} from "../cardHighlights";

const TEXT = "abcdefghijklmnopqrstuvwxyz";

const row = (
  id: string,
  start: number,
  end: number,
  fields: Partial<CardHighlight> = {}
): CardHighlight =>
  ({
    _creationTime: 1,
    _id: id,
    cardId: "card_1",
    createdAt: Number(id.slice(1)),
    end,
    quote: TEXT.slice(start, end),
    source: "reader",
    start,
    updatedAt: 1,
    userId: "u",
    ...fields,
  }) as CardHighlight;

const span = (start: number, end: number, note?: string) => ({
  start,
  end,
  quote: TEXT.slice(start, end),
  ...(note ? { note } : {}),
});

const stamp = {
  cardId: "card_1" as CardHighlight["cardId"],
  id: "temp",
  now: 99,
};

describe("withNewHighlight", () => {
  test("adds a new highlight in article order", () => {
    const { list, merged } = withNewHighlight(
      [row("h1", 10, 12)],
      span(2, 4, "note"),
      stamp
    );
    expect(merged).toBe(false);
    expect(list.map((item) => [item._id, item.quote, item.note])).toEqual([
      ["temp", "cd", "note"],
      ["h1", "kl", undefined],
    ]);
  });

  test("the same passage again changes nothing", () => {
    const list = [row("h1", 2, 4)];
    expect(withNewHighlight(list, span(2, 4), stamp)).toEqual({
      list,
      merged: false,
    });
  });

  test("merges every highlight it overlaps into the oldest, keeping the first note", () => {
    const { list, merged } = withNewHighlight(
      [
        row("h2", 0, 3, { note: "newer" }),
        row("h1", 6, 9, { note: "older" }),
        row("h3", 20, 22),
      ],
      span(2, 7, "typed"),
      stamp
    );
    expect(merged).toBe(true);
    expect(list.map((item) => [item._id, item.quote, item.note])).toEqual([
      ["h1", "abcdefghi", "older"],
      ["h3", "uv", undefined],
    ]);
  });

  test("leaves highlights waiting for the article alone", () => {
    const waiting = row("h1", 0, 0, {
      end: undefined,
      start: undefined,
      unanchored: true,
      quote: "abc",
    });
    const { list, merged } = withNewHighlight([waiting], span(0, 3), stamp);
    expect(merged).toBe(false);
    expect(list).toHaveLength(2);
    expect(list.at(-1)).toBe(waiting);
  });
});

describe("highlightProblem", () => {
  test.each([
    [{ code: "RATE_LIMITED", message: "x" }, "rateLimited"],
    [{ code: "HIGHLIGHT_LIMIT", message: "x" }, "limit"],
    [{ code: "NO_ARTICLE", message: "x" }, "noArticle"],
    [
      {
        code: "INVALID_INPUT",
        message: "Highlights can be up to 5,000 characters",
      },
      "tooLong",
    ],
    [{ code: "INVALID_INPUT", message: "Highlight some text" }, "failed"],
  ])("%j is %s", (data, problem) => {
    expect(highlightProblem(new ConvexError(data))).toBe(problem as never);
  });

  test("anything else failed", () => {
    expect(highlightProblem(new Error("offline"))).toBe("failed");
  });
});

describe("undoRemovalInput", () => {
  test("makes the passage again in the article it was made in, note and all", () => {
    expect(
      undoRemovalInput(
        row("h1", 2, 5, {
          articleKey: "users/u/cards/card_1/article-text/r1-a.md",
          note: "why",
          prefix: "ab",
          suffix: "fg",
        })
      )
    ).toEqual({
      articleKey: "users/u/cards/card_1/article-text/r1-a.md",
      end: 5,
      note: "why",
      prefix: "ab",
      quote: "cde",
      start: 2,
      suffix: "fg",
    });
  });

  test("a highlight waiting for its article, or with no article, can't come back", () => {
    expect(
      undoRemovalInput(row("h1", 2, 5, { articleKey: "key", unanchored: true }))
    ).toBeNull();
    expect(undoRemovalInput(row("h2", 2, 5))).toBeNull();
  });
});

describe("createPendingHighlightIds", () => {
  test("a highlight still being saved gets its real id once the save returns", async () => {
    const ids = createPendingHighlightIds();
    let finish: (value: { highlight: { _id: string } }) => void = () => {
      // replaced below
    };
    const saving = new Promise<{ highlight: { _id: string } }>((resolve) => {
      finish = resolve;
    });
    const tempId = optimisticHighlightId(1);
    ids.track(tempId, saving);

    const resolved = ids.resolve(tempId);
    finish({ highlight: { _id: "real_1" } });
    expect(await resolved).toBe("real_1");
    // A real id is sent as it is.
    expect(await ids.resolve("real_2")).toBe("real_2");
  });

  test("a save that failed, or an unknown temporary id, resolves to nothing", async () => {
    const ids = createPendingHighlightIds();
    ids.track(optimisticHighlightId(1), Promise.reject(new Error("refused")));
    expect(await ids.resolve(optimisticHighlightId(1))).toBeNull();
    expect(await ids.resolve(optimisticHighlightId(2))).toBeNull();
  });
});
