import { describe, expect, test } from "bun:test";
import {
  isThreadsPostUrl,
  mapThreadsOpenGraph,
  parseThreadsPostUrl,
} from "../../linkMetadata/threads";

const POST_URL = "https://www.threads.net/@zuck/post/C8abc123";

const page = {
  title: "Mark Zuckerberg (@zuck) on Threads",
  description: "We're rolling out a new feed today.",
  imageUrl: "https://scontent.cdninstagram.com/v/t51/photo.jpg",
  faviconUrl: "https://static.cdninstagram.com/favicon.ico",
  siteName: "Threads",
  finalUrl: POST_URL,
};

describe("parseThreadsPostUrl", () => {
  test.each([
    [POST_URL, "zuck"],
    ["https://www.threads.com/@zuck/post/C8abc123/", "zuck"],
  ])("reads the handle from %s", (url: string, handle: string) => {
    expect(parseThreadsPostUrl(url)).toBe(handle);
  });

  test.each([
    "https://www.threads.net/@zuck",
    "https://www.threads.net/@zuck/post/C8abc123/media",
    "https://example.com/@zuck/post/C8abc123",
  ])("ignores %s", (url: string) => {
    expect(isThreadsPostUrl(url)).toBe(false);
  });
});

describe("mapThreadsOpenGraph", () => {
  test("takes the post text, author and image from Open Graph", () => {
    expect(mapThreadsOpenGraph(POST_URL, page)).toMatchObject({
      title: "We're rolling out a new feed today.",
      description: "Mark Zuckerberg (@zuck) on Threads",
      author: "Mark Zuckerberg",
      siteName: "Threads",
      platform: "threads",
      categoryHint: "social_post",
      faviconUrl: page.faviconUrl,
      media: [{ type: "image", url: page.imageUrl }],
    });
  });

  test("names the author by handle when the title doesn't", () => {
    const post = mapThreadsOpenGraph(POST_URL, {
      ...page,
      title: "Threads",
    });

    expect(post?.author).toBe("@zuck");
  });

  test("returns null for a login wall without the post text", () => {
    expect(
      mapThreadsOpenGraph(POST_URL, { title: "Threads", siteName: "Threads" })
    ).toBeNull();
  });

  test("returns null for a page that isn't a post", () => {
    expect(
      mapThreadsOpenGraph("https://www.threads.net/@zuck", page)
    ).toBeNull();
  });
});
