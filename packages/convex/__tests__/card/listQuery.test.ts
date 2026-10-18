import { describe, expect, test } from "bun:test";
import {
  type ArchivedFilter,
  type CardListScope,
  cardListScope,
  scopeArchivedMatch,
  scopeDeletedMatch,
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
