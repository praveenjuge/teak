import { describe, expect, test } from "bun:test";
import type { GenericValidator } from "convex/values";
import { cardValidator } from "../../schema/validators/cards";
import {
  type CardStorageKeys,
  cardStorageObjectKeys,
  pickCardStorageKeys,
} from "../../storage/cardObjectKeys";

/** Card fields named like a key that don't name an R2 object. */
const NOT_OBJECT_KEYS = new Set([
  // The normalized link for the duplicate check (`shared/utils/urlKey`).
  "urlKey",
]);

const holdsObjectKey = (field: string) =>
  /(Key|Keys)$/u.test(field) && !NOT_OBJECT_KEYS.has(field);

let nextKey = 0;

/**
 * A value for `validator` with every R2 key field set to a fresh key, and
 * the keys it set; `undefined` when nothing under it holds a key.
 */
const fillKeys = (
  validator: GenericValidator,
  field: string,
  keys: string[]
): unknown => {
  switch (validator.kind) {
    case "string":
      if (!holdsObjectKey(field)) {
        return undefined;
      }
      nextKey += 1;
      keys.push(`object-${nextKey}`);
      return `object-${nextKey}`;
    case "array": {
      const item = fillKeys(validator.element, field, keys);
      return item === undefined ? undefined : [item];
    }
    case "object": {
      const value: Record<string, unknown> = {};
      for (const [name, fieldValidator] of Object.entries(validator.fields)) {
        const fieldValue = fillKeys(fieldValidator, name, keys);
        if (fieldValue !== undefined) {
          value[name] = fieldValue;
        }
      }
      if (Object.keys(value).length === 0) {
        return undefined;
      }
      for (const [name, fieldValidator] of Object.entries(validator.fields)) {
        if (fieldValidator.kind === "literal") {
          value[name] = fieldValidator.value;
        }
      }
      return value;
    }
    case "union": {
      let best: { keys: string[]; value: unknown } | undefined;
      for (const member of validator.members) {
        const memberKeys: string[] = [];
        const value = fillKeys(member, field, memberKeys);
        if (
          value !== undefined &&
          memberKeys.length > (best?.keys.length ?? 0)
        ) {
          best = { keys: memberKeys, value };
        }
      }
      if (!best) {
        return undefined;
      }
      keys.push(...best.keys);
      return best.value;
    }
    default:
      return undefined;
  }
};

describe("cardStorageObjectKeys", () => {
  test("lists every R2 key field a card has, including after the sweep's projection", () => {
    const keys: string[] = [];
    const card = fillKeys(cardValidator, "", keys) as CardStorageKeys;

    expect(keys.length).toBeGreaterThan(10);
    expect(cardStorageObjectKeys(card)).toEqual(expect.arrayContaining(keys));
    expect(cardStorageObjectKeys(pickCardStorageKeys(card))).toEqual(
      cardStorageObjectKeys(card)
    );
  });

  test("lists an object two fields share once", () => {
    expect(
      cardStorageObjectKeys({
        article: { imageKeys: [], status: "ready", textKey: "article-text" },
        documentTextKey: "article-text",
        metadata: {
          linkPreview: {
            imageStorageKey: "image",
            media: [{ storageKey: "image" }],
          },
        },
      })
    ).toEqual(["article-text", "image"]);
  });

  test("includes a file's legacy processing sidecar", () => {
    expect(cardStorageObjectKeys({ fileKey: "file" })).toEqual([
      "file",
      "file.processing.json",
    ]);
  });
});

describe("pickCardStorageKeys", () => {
  test("keeps only the fields that name objects", () => {
    expect(
      pickCardStorageKeys({
        article: { status: "none", extractedAt: 1 },
        previousThumbnailOverride: {
          override: { storageKey: "kept", width: 1, height: 1, updatedAt: 1 },
          changeId: "change",
          deleteAfter: 1,
        },
        thumbnailOverride: {
          storageKey: "chosen",
          width: 1,
          height: 1,
          updatedAt: 1,
        },
        type: "image",
        userId: "user",
      } as CardStorageKeys)
    ).toEqual({
      article: { status: "none" },
      previousThumbnailOverride: { override: { storageKey: "kept" } },
      thumbnailOverride: { storageKey: "chosen" },
    });
  });
});
