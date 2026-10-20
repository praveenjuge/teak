import { describe, expect, test } from "bun:test";
import { resolveLinkTitle } from "../linkTitle";

describe("resolveLinkTitle", () => {
  test("an edited or imported title wins over the fetched page title", () => {
    expect(
      resolveLinkTitle({
        metadataTitle: "My recipe bookmark",
        metadataTitleEdited: true,
        previewTitle: "Tomato soup - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Tomato_soup",
      })
    ).toBe("My recipe bookmark");
  });

  test("the fetched page title wins over an unedited stored title", () => {
    expect(
      resolveLinkTitle({
        metadataTitle: "old",
        previewTitle: "Tomato soup - Wikipedia",
      })
    ).toBe("Tomato soup - Wikipedia");
  });

  test("falls back to the stored title, then the URL, then a label", () => {
    expect(resolveLinkTitle({ metadataTitle: "stored" })).toBe("stored");
    expect(resolveLinkTitle({ url: "https://example.com" })).toBe(
      "https://example.com"
    );
    expect(resolveLinkTitle({})).toBe("Link");
  });
});
