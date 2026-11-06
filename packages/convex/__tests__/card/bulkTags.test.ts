import { describe, expect, test } from "bun:test";
import { normalizeBulkTags } from "../../card/bulkActions";
import { loadFixture } from "../shared/loadFixture";

const { rows } = loadFixture<{
  rows: { error: string | null; tags: string[]; text: string }[];
}>("bulkTags");

const MESSAGES: Record<string, RegExp> = {
  EMPTY: /at least one tag/,
  NAME_TOO_LONG: /at most 64 characters/,
  TOO_MANY_TAGS: /at most 20 tags/,
};

describe("normalizeBulkTags", () => {
  test.each(rows)("%#: $error", ({ text, tags, error }) => {
    const typed = text.split(",");
    if (error) {
      expect(() => normalizeBulkTags(typed)).toThrow(MESSAGES[error] as RegExp);
    } else {
      expect(normalizeBulkTags(typed).map((tag) => tag.toLowerCase())).toEqual(
        tags
      );
    }
  });
});
