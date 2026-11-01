import { describe, expect, test } from "bun:test";
import {
  type ArchivedFilter,
  type CardListScope,
  cardListScope,
  scopeArchivedMatch,
  scopeDeletedMatch,
  takeCardList,
} from "../../card/listQuery";

describe("cardListScope", () => {
  test.each<[archived: ArchivedFilter | undefined, scope: CardListScope]>([
    [undefined, "library"],
    ["exclude", "library"],
    ["only", "archive"],
    ["include", "libraryAndArchive"],
  ])("reads archived=%s outside Trash as %s", (archived, scope) => {
    expect(cardListScope(archived, false)).toBe(scope);
  });

  test.each<ArchivedFilter | undefined>([
    undefined,
    "exclude",
    "only",
    "include",
  ])("Trash lists every trashed card whatever archived=%s says", (archived) => {
    expect(cardListScope(archived, true)).toBe("trash");
  });
});

describe("scope index values", () => {
  test.each<
    [
      scope: CardListScope,
      isDeleted: true | undefined,
      isArchived: true | undefined | "any",
    ]
  >([
    ["library", undefined, undefined],
    ["archive", undefined, true],
    ["libraryAndArchive", undefined, "any"],
    ["trash", true, "any"],
  ])(
    "%s reads isDeleted=%s and isArchived=%s",
    (scope, isDeleted, isArchived) => {
      expect(scopeDeletedMatch(scope)).toBe(isDeleted);
      expect(scopeArchivedMatch(scope)).toBe(isArchived);
    }
  );

  test("an unset scope reads the library", () => {
    expect(scopeDeletedMatch()).toBeUndefined();
    expect(scopeArchivedMatch()).toBeUndefined();
  });
});

interface FakeCard {
  _creationTime: number;
  _id: string;
  createdAt: number;
  isArchived?: true;
  isDeleted?: boolean;
  isFavorited?: boolean;
  isHidden?: true;
  type: string;
  userId: string;
}

const scannedCards = (cards: FakeCard[]) => {
  let rowsRead = 0;
  const field = (card: FakeCard, name: string) =>
    (card as unknown as Record<string, unknown>)[name];
  const db = {
    query: () => ({
      withIndex: (_index: string, range?: (q: unknown) => unknown) => {
        const checks: ((card: FakeCard) => boolean)[] = [];
        const builder = {
          eq: (name: string, value: unknown) => {
            checks.push((card) => field(card, name) === value);
            return builder;
          },
          gte: (name: string, value: number) => {
            checks.push((card) => (field(card, name) as number) >= value);
            return builder;
          },
          lt: (name: string, value: number) => {
            checks.push((card) => (field(card, name) as number) < value);
            return builder;
          },
          lte: (name: string, value: number) => {
            checks.push((card) => (field(card, name) as number) <= value);
            return builder;
          },
        };
        range?.(builder);
        const rows = cards
          .filter((card) => checks.every((check) => check(card)))
          .sort(
            (a, b) =>
              a.createdAt - b.createdAt || a._creationTime - b._creationTime
          );
        return {
          order: (order: "asc" | "desc") => ({
            [Symbol.asyncIterator]() {
              const iterator = (order === "desc" ? rows.reverse() : rows)[
                Symbol.iterator
              ]();
              return {
                next: () => {
                  const result = iterator.next();
                  if (!result.done) {
                    rowsRead += 1;
                  }
                  return Promise.resolve(result);
                },
              };
            },
          }),
        };
      },
    }),
  };
  return { ctx: { db } as never, rowsRead: () => rowsRead };
};

const libraryWith = (rare: Partial<FakeCard>[], common = 300): FakeCard[] => {
  const cards: FakeCard[] = [];
  const add = (card: Partial<FakeCard>) => {
    const at = cards.length + 1;
    cards.push({
      _id: `c${at}`,
      _creationTime: at,
      createdAt: at,
      type: "text",
      userId: "u1",
      ...card,
    });
  };
  for (const card of rare) {
    add(card);
  }
  for (let index = 0; index < common; index += 1) {
    add({});
  }
  return cards;
};

describe("takeCardList", () => {
  test("lists several rare types newest first, reading only their rows", async () => {
    const { ctx, rowsRead } = scannedCards(
      libraryWith([
        { type: "link" },
        { type: "image" },
        { type: "link", isArchived: true },
        { type: "link" },
        { type: "image", isHidden: true },
      ])
    );

    const listed = await takeCardList(
      ctx,
      { userId: "u1", types: ["link", "image"] },
      "desc",
      2
    );

    expect(listed.map((card) => String(card._id))).toEqual(["c4", "c2"]);
    expect(rowsRead()).toBeLessThanOrEqual(6);
  });

  test("lists favourites across archive states, reading only favourites", async () => {
    const { ctx, rowsRead } = scannedCards(
      libraryWith([
        { isFavorited: true, isDeleted: true },
        { isFavorited: true, isDeleted: true, isArchived: true },
        { isFavorited: true },
        ...Array.from({ length: 300 }, () => ({ isDeleted: true })),
      ])
    );

    const listed = await takeCardList(
      ctx,
      { userId: "u1", scope: "trash", favoritesOnly: true },
      "asc",
      5
    );

    expect(listed.map((card) => String(card._id))).toEqual(["c1", "c2"]);
    expect(rowsRead()).toBeLessThanOrEqual(2);
  });
});
