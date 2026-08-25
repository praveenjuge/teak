import { describe, expect, test } from "bun:test";
import { stalePendingUploadKeys } from "../../storage/pendingUploadCleanup";

describe("stalePendingUploadKeys", () => {
  const now = Date.UTC(2026, 7, 19, 12);

  test("selects only pending card uploads older than one day", () => {
    expect(
      stalePendingUploadKeys(
        [
          {
            key: "users/a/cards/upload-pending-v2/file/old",
            lastModified: now - 25 * 60 * 60 * 1000,
          },
          {
            key: "users/a/cards/upload-pending-v2/file/recent",
            lastModified: now - 60 * 60 * 1000,
          },
          {
            key: "users/a/cards/card-1/file/old",
            lastModified: now - 25 * 60 * 60 * 1000,
          },
        ],
        now
      )
    ).toEqual(["users/a/cards/upload-pending-v2/file/old"]);
  });
});
