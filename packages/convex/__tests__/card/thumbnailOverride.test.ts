import { describe, expect, test } from "bun:test";
import {
  buildPendingThumbnailKey,
  isPendingThumbnailKeyFor,
} from "../../card/thumbnailOverride";
import { toThumbnailMimeType } from "../../shared/thumbnails";
import { buildR2ObjectKey } from "../../storage/r2";

const CARD = "k57c8p0w2y3d4e5f6g7h8j9k0m1n2p3q";
const OTHER_CARD = "k57c8p0w2y3d4e5f6g7h8j9k0m1n2p3r";

describe("pending link image keys", () => {
  test("land in the pending namespace the 24-hour sweep empties", () => {
    const key = buildPendingThumbnailKey("teak_owner", CARD);
    // The sweep (apps/files-worker/src/ops.ts) deletes stale objects under
    // this segment only.
    expect(key).toContain("/cards/upload-pending-v2/");
    expect(key).toMatch(
      new RegExp(`/thumbnail-override-pending/[0-9a-f-]{36}-card-${CARD}$`)
    );
    expect(isPendingThumbnailKeyFor("teak_owner", CARD, key)).toBe(true);
  });

  test("are refused for another card, user or role", () => {
    const key = buildPendingThumbnailKey("teak_owner", CARD);
    expect(isPendingThumbnailKeyFor("teak_owner", OTHER_CARD, key)).toBe(false);
    expect(isPendingThumbnailKeyFor("teak_other", CARD, key)).toBe(false);
    const file = buildR2ObjectKey({
      userId: "teak_owner",
      cardId: "upload-pending-v2",
      role: "file",
      fileName: `card-${CARD}`,
    });
    expect(isPendingThumbnailKeyFor("teak_owner", CARD, file)).toBe(false);
    const stored = buildR2ObjectKey({
      userId: "teak_owner",
      cardId: CARD,
      role: "thumbnail-override",
    });
    expect(isPendingThumbnailKeyFor("teak_owner", CARD, stored)).toBe(false);
  });

  test("are refused when the name only ends like one", () => {
    const key = buildPendingThumbnailKey("teak_owner", CARD);
    const prefix = key.slice(0, key.lastIndexOf("/") + 1);
    expect(
      isPendingThumbnailKeyFor("teak_owner", CARD, `${prefix}x-card-${CARD}`)
    ).toBe(false);
    expect(
      isPendingThumbnailKeyFor(
        "teak_owner",
        CARD,
        `${prefix}../file/${key.slice(prefix.length)}`
      )
    ).toBe(false);
  });
});

describe("link image types", () => {
  test.each([
    ["image/jpeg", "image/jpeg"],
    ["image/JPG", "image/jpeg"],
    ["image/png; charset=binary", "image/png"],
    ["image/webp", "image/webp"],
    ["image/gif", "image/gif"],
    ["image/avif", "image/avif"],
    ["image/svg+xml", null],
    ["image/heic", null],
    ["image/heif", null],
    ["text/plain", null],
    ["", null],
  ])("%s is %s", (input: string, expected: string | null) => {
    expect(toThumbnailMimeType(input)).toBe(expected);
  });
});
