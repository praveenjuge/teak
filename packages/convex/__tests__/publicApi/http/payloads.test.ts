import { describe, expect, test } from "bun:test";
import {
  parseCreatePayload,
  parsePatchPayload,
  validateCreatePayload,
  validateFavoritePayload,
  validatePatchPayload,
  validateUploadPayload,
} from "../../../publicApi/http/payloads";

describe("validateCreatePayload", () => {
  test("accepts a text card and keeps notes, tags and source", () => {
    expect(
      validateCreatePayload({
        content: "Remember this",
        notes: "from a meeting",
        source: "cli",
        tags: [" design ", "design", "", "ideas"],
      })
    ).toEqual({
      cardType: undefined,
      content: "Remember this",
      notes: "from a meeting",
      source: "cli",
      tags: ["design", "ideas"],
      url: undefined,
    });
  });

  test("accepts a link card with only a url", () => {
    expect(validateCreatePayload({ url: "https://example.com" })).toMatchObject(
      { url: "https://example.com" }
    );
  });

  test("accepts an uploaded file card that names its file", () => {
    expect(
      validateCreatePayload({
        fileKey: "uploads/abc",
        fileName: "report.pdf",
        fileSize: 2048,
        mimeType: "application/pdf",
      })
    ).toMatchObject({
      fileKey: "uploads/abc",
      fileName: "report.pdf",
      fileSize: 2048,
      mimeType: "application/pdf",
    });
  });

  test.each([
    ["a non-object body", "hello"],
    ["an array body", [{ content: "x" }]],
    ["null", null],
    ["an unknown field", { content: "x", color: "red" }],
    ["a non-string content", { content: 42 }],
    ["no content and no url", { notes: "only notes" }],
    ["blank content on a non-text card", { cardType: "quote", content: "  " }],
    ["an unknown card type", { cardType: "spreadsheet", content: "x" }],
    ["a javascript: url", { url: "javascript:alert(1)" }],
    ["tags that are not strings", { content: "x", tags: ["ok", 1] }],
    ["a non-numeric file size", { content: "x", fileSize: "big" }],
    ["file fields without a fileKey", { content: "x", fileName: "a.pdf" }],
    [
      "a fileKey without a file name",
      { fileKey: "uploads/abc", mimeType: "application/pdf" },
    ],
    [
      "a fileKey together with a url",
      {
        fileKey: "uploads/abc",
        fileName: "a.pdf",
        mimeType: "application/pdf",
        url: "https://example.com",
      },
    ],
    ["numeric notes", { content: "x", notes: 5 }],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateCreatePayload(payload)).toBeNull();
  });
});

describe("parseCreatePayload", () => {
  test.each([
    [
      "a file type without a file",
      { content: "x", cardType: "image" },
      "`cardType` `image` needs an uploaded file",
    ],
    [
      "a document type without a file",
      { content: "notes", cardType: "document" },
      "`cardType` `document` needs an uploaded file",
    ],
    [
      "a palette with no colors",
      { content: "just words", cardType: "palette" },
      "A `palette` card needs at least one color",
    ],
    [
      "a tag over 64 characters",
      { content: "x", tags: ["a".repeat(65)] },
      "Each tag must be at most 64 characters",
    ],
    [
      "an unknown field",
      { content: "x", color: "red" },
      "Unknown field `color`",
    ],
    [
      "no content and no url",
      { notes: "n" },
      "Body must include `content` or `url`",
    ],
  ])("explains %s", (_label: string, payload: unknown, error: string) => {
    const result = parseCreatePayload(payload);
    expect("error" in result && result.error).toContain(error);
  });

  test("accepts a palette with a readable color and a 64-character tag", () => {
    expect(
      parseCreatePayload({
        content: "#ff5500 and #112233",
        cardType: "palette",
        tags: ["a".repeat(64)],
      })
    ).toMatchObject({ payload: { cardType: "palette" } });
  });

  test("lets an uploaded file choose a file card type", () => {
    expect(
      parseCreatePayload({
        cardType: "image",
        fileKey: "uploads/a",
        fileName: "a.png",
        mimeType: "image/png",
      })
    ).toMatchObject({ payload: { cardType: "image", fileKey: "uploads/a" } });
  });
});

describe("parseCreatePayload: sourceUrl and sourceTitle", () => {
  test("keeps a text card's page, trimmed, with its title", () => {
    expect(
      parseCreatePayload({
        cardType: "text",
        content: "A quote worth keeping",
        sourceTitle: "  An essay  ",
        sourceUrl: " https://example.com/essay ",
      })
    ).toMatchObject({
      payload: {
        sourceTitle: "An essay",
        sourceUrl: "https://example.com/essay",
      },
    });
  });

  test("cuts a long title to 300 characters", () => {
    const result = parseCreatePayload({
      content: "x",
      sourceTitle: "t".repeat(500),
      sourceUrl: "https://example.com",
    });
    expect("payload" in result && result.payload.sourceTitle).toBe(
      "t".repeat(300)
    );
  });

  test("leaves out a blank title", () => {
    const result = parseCreatePayload({
      content: "x",
      sourceTitle: "   ",
      sourceUrl: "https://example.com",
    });
    expect("payload" in result && "sourceTitle" in result.payload).toBe(false);
  });

  test("allows a page beside a link's url", () => {
    expect(
      parseCreatePayload({
        sourceUrl: "https://example.com/where-i-found-it",
        url: "https://example.org/the-link",
      })
    ).toMatchObject({
      payload: {
        sourceUrl: "https://example.com/where-i-found-it",
        url: "https://example.org/the-link",
      },
    });
  });

  test.each([
    [
      "a javascript: sourceUrl",
      { content: "x", sourceUrl: "javascript:alert(1)" },
      "`sourceUrl` must use the http or https scheme",
    ],
    [
      "a 3,000-character sourceUrl",
      { content: "x", sourceUrl: `https://example.com/${"a".repeat(3000)}` },
      "`sourceUrl` must be at most 2048 characters",
    ],
    [
      "a sourceUrl that isn't a string",
      { content: "x", sourceUrl: 42 },
      "`sourceUrl` must be a string",
    ],
    [
      "a blank sourceUrl",
      { content: "x", sourceUrl: "  " },
      "`sourceUrl` cannot be blank",
    ],
    [
      "a title without a sourceUrl",
      { content: "x", sourceTitle: "An essay" },
      "`sourceTitle` needs a `sourceUrl`",
    ],
    [
      "a sourceUrl with an uploaded file",
      {
        fileKey: "uploads/abc",
        fileName: "a.pdf",
        mimeType: "application/pdf",
        sourceUrl: "https://example.com",
      },
      "`sourceUrl` can't be sent with an uploaded `fileKey`",
    ],
  ])("explains %s", (_label: string, payload: unknown, error: string) => {
    const result = parseCreatePayload(payload);
    expect("error" in result && result.error).toBe(error);
  });
});

describe("validateUploadPayload", () => {
  test("accepts a named file with a size and type", () => {
    expect(
      validateUploadPayload({
        fileName: "clip.mp4",
        fileSize: 10,
        mimeType: "video/mp4",
      })
    ).toEqual({ fileName: "clip.mp4", fileSize: 10, mimeType: "video/mp4" });
  });

  test.each([
    ["a missing size", { fileName: "a.png", mimeType: "image/png" }],
    [
      "a string size",
      { fileName: "a.png", fileSize: "10", mimeType: "image/png" },
    ],
    ["a missing type", { fileName: "a.png", fileSize: 10 }],
    [
      "an extra field",
      { fileName: "a.png", fileSize: 10, mimeType: "image/png", url: "x" },
    ],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateUploadPayload(payload)).toBeNull();
  });
});

describe("validatePatchPayload", () => {
  test("normalizes editable titles and preserves old patch payloads", () => {
    expect(validatePatchPayload({ metadataTitle: "  New title  " })).toEqual({
      metadataTitle: "New title",
    });
    expect(validatePatchPayload({ metadataTitle: null })).toEqual({
      metadataTitle: null,
    });
    expect(validatePatchPayload({ metadataTitle: "  " })).toEqual({
      metadataTitle: null,
    });
    expect(validatePatchPayload({ notes: " note " })).toEqual({
      notes: "note",
    });
    expect(
      validatePatchPayload({ metadataTitle: "x".repeat(512) })?.metadataTitle
    ).toHaveLength(512);
  });

  test("cuts an oversized title to 512 characters instead of rejecting it", () => {
    expect(
      validatePatchPayload({ metadataTitle: ` ${"x".repeat(600)} ` })
        ?.metadataTitle
    ).toBe("x".repeat(512));
    expect(
      validatePatchPayload({ metadataTitle: `${"x".repeat(511)}😀tail` })
        ?.metadataTitle,
      "a cut never leaves half of a surrogate pair"
    ).toBe("x".repeat(511));
  });

  test.each(
    [42, true, [], {}].map((metadataTitle) => ({
      metadataTitle,
    }))
  )(
    "rejects invalid title %j",
    ({ metadataTitle }: { metadataTitle: unknown }) => {
      expect(validatePatchPayload({ metadataTitle })).toBeNull();
    }
  );

  test("trims the url and turns blank notes into a cleared note", () => {
    expect(
      validatePatchPayload({
        notes: "   ",
        tags: ["a", "a", " b "],
        url: "  https://example.com/x  ",
      })
    ).toEqual({ notes: null, tags: ["a", "b"], url: "https://example.com/x" });
  });

  test("allows clearing notes with null", () => {
    expect(validatePatchPayload({ notes: null })).toEqual({ notes: null });
  });

  test.each([
    ["an empty patch", {}],
    ["an unknown field", { title: "x" }],
    ["a blank url", { url: "   " }],
    ["an unsafe url", { url: "file:///etc/passwd" }],
    ["non-string content", { content: ["x"] }],
    ["non-array tags", { tags: "design" }],
    ["a tag over 64 characters", { tags: ["a".repeat(65)] }],
    ["a string archive flag", { isArchived: "true" }],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validatePatchPayload(payload)).toBeNull();
  });

  test("accepts archiving on its own or with other edits", () => {
    expect(validatePatchPayload({ isArchived: true })).toEqual({
      isArchived: true,
    });
    expect(validatePatchPayload({ isArchived: false, notes: "n" })).toEqual({
      isArchived: false,
      notes: "n",
    });
  });
});

describe("parsePatchPayload", () => {
  test.each([
    [{ url: "javascript:alert(1)" }, "`url` must use the http or https scheme"],
    [{ tags: ["x".repeat(65)] }, "Each tag must be at most 64 characters"],
    [
      { folderIds: Array.from({ length: 51 }, (_, i) => `f${i}`) },
      "A card can be in at most 50 folders",
    ],
    [{ isArchived: "true" }, "`isArchived` must be true or false"],
    [{ color: "red" }, "Unknown field `color`"],
    [{}, "Body must include at least one of"],
  ])("says what is wrong with %j", (body, message) => {
    const result = parsePatchPayload(body);
    expect("error" in result && result.error).toContain(message);
  });

  test("refuses notes over 256 KiB as content too large", () => {
    expect(parsePatchPayload({ notes: "é".repeat(128 * 1024 + 1) })).toEqual({
      code: "CONTENT_TOO_LARGE",
      error: "Notes must not exceed 256 KiB when encoded as UTF-8.",
    });
    expect(parsePatchPayload({ notes: "é".repeat(128 * 1024) })).toEqual({
      payload: { notes: "é".repeat(128 * 1024) },
    });
  });
});

describe("parseCreatePayload: size limits", () => {
  test.each([
    [{ content: "hi", notes: "a".repeat(256 * 1024 + 1) }, "Notes must not"],
    [{ content: `"${"q".repeat(512 * 1024)}"` }, "Text card content"],
    [
      { cardType: "link", content: "a".repeat(512 * 1024 + 1) },
      "Text card content",
    ],
  ])("refuses an oversized field on any card type", (body, message) => {
    const result = parseCreatePayload(body);
    expect(result).toMatchObject({ code: "CONTENT_TOO_LARGE" });
    expect("error" in result && result.error).toContain(message);
  });
});

describe("validateFavoritePayload", () => {
  test("accepts exactly an isFavorited boolean", () => {
    expect(validateFavoritePayload({ isFavorited: true })).toEqual({
      isFavorited: true,
    });
  });

  test.each([
    ["a string flag", { isFavorited: "true" }],
    ["an extra field", { isFavorited: true, note: "x" }],
    ["an empty body", {}],
  ])("rejects %s", (_label: string, payload: unknown) => {
    expect(validateFavoritePayload(payload)).toBeNull();
  });
});

describe("parseCreatePayload: pageSnapshotKey", () => {
  test("keeps a link's page snapshot key", () => {
    expect(
      parseCreatePayload({
        pageSnapshotKey: "users/u/cards/upload-pending-v2/page-snapshot/s1",
        url: "https://example.com/post",
      })
    ).toMatchObject({
      payload: {
        pageSnapshotKey: "users/u/cards/upload-pending-v2/page-snapshot/s1",
      },
    });
  });

  test.each([
    [
      "beside an uploaded file",
      {
        fileKey: "uploads/a",
        fileName: "a.png",
        mimeType: "image/png",
        pageSnapshotKey: "k",
      },
      "`pageSnapshotKey` can't be sent with an uploaded `fileKey`",
    ],
    [
      "that isn't a string",
      { pageSnapshotKey: 42, url: "https://example.com" },
      "`pageSnapshotKey` must be a string",
    ],
  ])("refuses one %s", (_name, body, error) => {
    expect(parseCreatePayload(body)).toEqual({ error });
  });
});
