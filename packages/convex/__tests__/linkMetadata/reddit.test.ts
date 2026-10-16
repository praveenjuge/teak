import { describe, expect, test } from "bun:test";
import {
  fetchRedditPost,
  isRedditPostUrl,
  parseRedditPostPath,
} from "../../linkMetadata/reddit";
import {
  jsonResponse,
  socialFetch,
  socialFixture,
} from "../helpers/socialFetch.test-utils";

const POST_URL =
  "https://www.reddit.com/r/battlestations/comments/abc123/my_desk_setup/";
const JSON_URL =
  "https://www.reddit.com/r/battlestations/comments/abc123.json?raw_json=1";
const OEMBED_PREFIX = "https://www.reddit.com/oembed?url=";

const listing = (post: Record<string, unknown>) => [
  { kind: "Listing", data: { children: [{ kind: "t3", data: post }] } },
  { kind: "Listing", data: { children: [] } },
];

const reddit = (body: unknown) =>
  socialFetch((url) => (url === JSON_URL ? jsonResponse(body) : undefined));

describe("parseRedditPostPath", () => {
  test.each([
    [POST_URL, "/r/battlestations/comments/abc123"],
    [
      "https://old.reddit.com/r/battlestations/comments/abc123",
      "/r/battlestations/comments/abc123",
    ],
    ["https://reddit.com/comments/abc123/", "/comments/abc123"],
  ])("reads %s", (url: string, path: string) => {
    expect(parseRedditPostPath(url)).toBe(path);
  });

  test.each([
    "https://www.reddit.com/r/battlestations/",
    "https://www.reddit.com/user/deskfan",
    "https://www.reddit.com/r/a/comments/abc123/slug/comment123/",
    "https://notreddit.com/r/a/comments/abc123/",
  ])("ignores %s", (url: string) => {
    expect(isRedditPostUrl(url)).toBe(false);
  });
});

describe("fetchRedditPost", () => {
  test("reads a gallery's first ten images, its author, subreddit and date", async () => {
    const { deps, requests } = reddit(socialFixture("reddit-gallery.json"));

    const post = await fetchRedditPost(POST_URL, deps);

    expect(post).toMatchObject({
      title: "My desk setup, 12 angles",
      description: "u/deskfan on r/battlestations · November 14, 2023",
      author: "u/deskfan",
      publishedAt: "2023-11-14T22:13:20.000Z",
      siteName: "Reddit",
      platform: "reddit",
      categoryHint: "social_post",
    });
    expect(post?.media).toHaveLength(10);
    expect(post?.media?.[0]).toEqual({
      type: "image",
      url: "https://preview.redd.it/m1.jpg?width=1080&s=a",
      contentType: "image/jpg",
      width: 1080,
      height: 720,
    });
    expect(requests).toEqual([JSON_URL]);
  });

  test("puts a long text post in the description, up to 4,000 characters", async () => {
    const selftext = "lorem ipsum ".repeat(500).trim();
    const { deps } = reddit(
      listing({
        title: "A long one",
        selftext,
        author: "writer",
        subreddit: "WritingPrompts",
        created_utc: 1_700_000_000,
        over_18: true,
      })
    );

    const post = await fetchRedditPost(POST_URL, deps);

    expect(post?.title).toHaveLength(512);
    expect(post?.title).toStartWith("A long one lorem ipsum");
    expect(post?.description).toHaveLength(4000);
    expect(post?.media).toBeUndefined();
  });

  test("keeps a hosted video as an MP4 with the preview as its poster", async () => {
    const { deps } = reddit(
      listing({
        title: "Clip",
        author: "a",
        subreddit: "videos",
        created_utc: 1_700_000_000,
        is_video: true,
        media: {
          reddit_video: {
            fallback_url: "https://v.redd.it/xyz/DASH_720.mp4?source=fallback",
            hls_url: "https://v.redd.it/xyz/HLSPlaylist.m3u8",
            width: 1280,
            height: 720,
          },
        },
        preview: {
          images: [
            {
              source: {
                url: "https://external-preview.redd.it/xyz.png",
                width: 1280,
                height: 720,
              },
            },
          ],
        },
      })
    );

    const post = await fetchRedditPost(POST_URL, deps);

    expect(post?.media).toEqual([
      {
        type: "video",
        url: "https://v.redd.it/xyz/DASH_720.mp4?source=fallback",
        contentType: "video/mp4",
        width: 1280,
        height: 720,
        posterUrl: "https://external-preview.redd.it/xyz.png",
        posterWidth: 1280,
        posterHeight: 720,
      },
    ]);
  });

  test("returns null for a removed post", async () => {
    const { deps } = reddit(
      listing({
        title: "[ Removed by Reddit ]",
        selftext: "[removed]",
        removed_by_category: "moderator",
      })
    );

    expect(await fetchRedditPost(POST_URL, deps)).toBeNull();
  });

  test.each([403, 429])(
    "falls back to oEmbed when Reddit answers %d",
    async (status: number) => {
      const { deps, requests } = socialFetch((url) => {
        if (url === JSON_URL) {
          return new Response("blocked", { status });
        }
        if (url.startsWith(OEMBED_PREFIX)) {
          return jsonResponse({
            title: "My desk setup, 12 angles",
            author_name: "deskfan",
            provider_name: "reddit",
          });
        }
      });

      const post = await fetchRedditPost(POST_URL, deps);

      expect(post).toMatchObject({
        title: "My desk setup, 12 angles",
        author: "u/deskfan",
        description: "u/deskfan on Reddit",
        categoryHint: "social_post",
      });
      expect(requests).toEqual([
        JSON_URL,
        `${OEMBED_PREFIX}${encodeURIComponent(POST_URL)}`,
      ]);
    }
  );

  test("returns null when oEmbed is refused too", async () => {
    const { deps } = socialFetch(() => new Response("no", { status: 429 }));

    expect(await fetchRedditPost(POST_URL, deps)).toBeNull();
  });

  test("returns null without trying oEmbed when Reddit fails with 500", async () => {
    const { deps, requests } = socialFetch(
      () => new Response("down", { status: 500 })
    );

    expect(await fetchRedditPost(POST_URL, deps)).toBeNull();
    expect(requests).toEqual([JSON_URL]);
  });
});
