import { describe, expect, test } from "bun:test";
import { buildStalePendingCleanupSpec } from "../../storage/pendingUploadCleanup";

describe("buildStalePendingCleanupSpec", () => {
  test("moves the whole stale-object sweep behind one worker operation", () => {
    const now = Date.UTC(2026, 8, 15, 4, 30);
    expect(buildStalePendingCleanupSpec(now)).toEqual({
      op: "cleanup-stale-pending-uploads",
      params: {
        maxPages: 200,
        pendingCardId: "upload-pending-v2",
        prefix: "users/",
        staleBefore: now - 24 * 60 * 60 * 1000,
      },
    });
  });
});
