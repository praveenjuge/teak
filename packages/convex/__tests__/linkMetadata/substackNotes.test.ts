import { describe, expect, test } from "bun:test";
import {
  isSubstackNoteUrl,
  mapSubstackNoteOpenGraph,
  parseSubstackNoteUrl,
} from "../../linkMetadata/substackNotes";

const NOTE_URL = "https://substack.com/@writer/note/c-12345678";

describe("parseSubstackNoteUrl", () => {
  test.each([
    [NOTE_URL, { handle: "writer" }],
    ["https://substack.com/note/c-12345678", { handle: undefined }],
  ])("reads %s", (url: string, ref: unknown) => {
    expect(parseSubstackNoteUrl(url)).toEqual(ref);
  });

  test.each([
    "https://writer.substack.com/p/a-long-read",
    "https://substack.com/@writer",
    "https://example.com/@writer/note/c-1",
  ])("ignores %s", (url: string) => {
    expect(isSubstackNoteUrl(url)).toBe(false);
  });
});

describe("mapSubstackNoteOpenGraph", () => {
  test("takes the note text, author and image from Open Graph", () => {
    const post = mapSubstackNoteOpenGraph(NOTE_URL, {
      title: "Ada Writer (@writer) on Substack",
      description: "A short note about long reads. 長い文章について。",
      imageUrl: "https://substackcdn.com/image/fetch/note.png",
    });

    expect(post).toMatchObject({
      title: "A short note about long reads. 長い文章について。",
      description: "Ada Writer (@writer) on Substack",
      author: "Ada Writer",
      siteName: "Substack",
      platform: "substack_notes",
      categoryHint: "social_post",
      media: [
        { type: "image", url: "https://substackcdn.com/image/fetch/note.png" },
      ],
    });
  });

  test("names the author by handle when the title doesn't", () => {
    const post = mapSubstackNoteOpenGraph(NOTE_URL, {
      title: "Substack",
      description: "Hi",
    });

    expect(post?.author).toBe("@writer");
  });

  test("returns null without the note text", () => {
    expect(
      mapSubstackNoteOpenGraph(NOTE_URL, { title: "Ada on Substack" })
    ).toBeNull();
  });
});
