import { describe, expect, test } from "bun:test";
import { documentTextKey } from "../../card/documentText";

describe("documentTextKey", () => {
  test("lives under the card in its owner's namespace, named by digest", () => {
    const key = documentTextKey(
      { _id: "abc123" as never, userId: "u1" },
      "f".repeat(64)
    );
    expect(key).toMatch(/\/abc123\/document-text\/f{64}\.txt$/);
    expect(() =>
      documentTextKey({ _id: "abc123" as never, userId: "u1" }, "nothex")
    ).toThrow("document_text_invalid_key");
  });
});
