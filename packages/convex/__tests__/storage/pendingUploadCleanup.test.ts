import { describe, expect, test } from "bun:test";
import { stalePendingUploadKeys } from "../../storage/pendingUploadCleanup";

describe("stalePendingUploadKeys", () => {
  const now = Date.UTC(2026, 7, 19, 12);

  test("selects only pending card uploads older than one day", () => {
    expect(
      stalePendingUploadKeys(
        [
          {
            Key: "users/a/cards/upload-pending-v2/file/old",
            LastModified: new Date(now - 25 * 60 * 60 * 1000),
          },
          {
            Key: "users/a/cards/upload-pending-v2/file/recent",
            LastModified: new Date(now - 60 * 60 * 1000),
          },
          {
            Key: "users/a/cards/card-1/file/old",
            LastModified: new Date(now - 25 * 60 * 60 * 1000),
          },
        ],
        now
      )
    ).toEqual(["users/a/cards/upload-pending-v2/file/old"]);
  });

  test("keeps objects whose modification time is unavailable", () => {
    expect(
      stalePendingUploadKeys(
        [{ Key: "users/a/cards/upload-pending-v2/file/unknown" }],
        now
      )
    ).toEqual([]);
  });
});
