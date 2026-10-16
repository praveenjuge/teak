import { describe, expect, test } from "bun:test";
import {
  fetchSocialPostMetadata,
  mapOpenGraphSocialPost,
  toSocialPostPreviewFields,
} from "../../linkMetadata/socialPost";
import {
  buildSocialPostText,
  htmlToText,
} from "../../linkMetadata/socialPostHelpers";
import {
  jsonResponse,
  socialFetch,
  socialFixture,
} from "../helpers/socialFetch.test-utils";

describe("fetchSocialPostMetadata", () => {
  test.each([
    [
      "https://bsky.app/profile/did:plc:abc/post/3kabc",
      "https://public.api.bsky.app/",
    ],
    [
      "https://www.reddit.com/r/a/comments/abc123/",
      "https://www.reddit.com/r/a/comments/abc123.json",
    ],
    [
      "https://www.tiktok.com/@a/video/6718335390845095173",
      "https://www.tiktok.com/oembed",
    ],
    [
      "https://mastodon.social/@a/42",
      "https://mastodon.social/api/v1/statuses/42",
    ],
  ])("asks the right API for %s", async (url: string, apiPrefix: string) => {
    const { deps, requests } = socialFetch(() => undefined);

    expect(await fetchSocialPostMetadata(url, deps)).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toStartWith(apiPrefix);
  });

  test.each([
    "https://example.com/article",
    "https://x.com/jack/status/20",
    "https://www.threads.net/@zuck/post/C8abc123",
    "https://www.instagram.com/p/DBY4WfSxA0a/",
  ])("makes no request for %s", async (url: string) => {
    const { deps, requests } = socialFetch(() => jsonResponse({}));

    expect(await fetchSocialPostMetadata(url, deps)).toBeNull();
    expect(requests).toEqual([]);
  });

  test("returns null instead of throwing when the transport fails", async () => {
    const { deps } = socialFetch(() => {
      throw new TypeError("fetch failed");
    });

    expect(
      await fetchSocialPostMetadata("https://mastodon.social/@a/42", deps)
    ).toBeNull();
  });

  test("returns the post an API confirmed", async () => {
    const { deps } = socialFetch((url) =>
      url.startsWith("https://mastodon.social/api/v1/statuses/")
        ? jsonResponse(socialFixture("mastodon-status.json"))
        : undefined
    );

    const post = await fetchSocialPostMetadata(
      "https://mastodon.social/@Gargron/109311046116149744",
      deps
    );

    expect(post?.platform).toBe("mastodon");
  });
});

describe("mapOpenGraphSocialPost", () => {
  const page = { title: "Ada (@ada) on Threads", description: "Hello" };

  test.each([
    ["https://www.threads.net/@ada/post/C8abc", "threads"],
    ["https://www.linkedin.com/posts/ada_hello-activity-7100-abcd", "linkedin"],
    ["https://substack.com/@ada/note/c-1", "substack_notes"],
  ])("maps %s as %s", (url: string, platform: string) => {
    expect<string | undefined>(
      mapOpenGraphSocialPost(url, page)?.platform
    ).toBe(platform);
  });

  test("leaves other pages to the generic preview", () => {
    expect(mapOpenGraphSocialPost("https://example.com/a", page)).toBeNull();
  });
});

describe("toSocialPostPreviewFields", () => {
  test("drops the platform and the unstored media, keeping the hint", () => {
    const post = mapOpenGraphSocialPost(
      "https://www.threads.net/@ada/post/C8abc",
      { description: "Hello", imageUrl: "https://example.com/a.jpg" }
    );
    if (!post) {
      throw new Error("expected a post");
    }

    const fields = toSocialPostPreviewFields(post);

    expect(fields).not.toHaveProperty("platform");
    expect(fields).not.toHaveProperty("media");
    expect(fields.categoryHint).toBe("social_post");
  });
});

describe("social post text", () => {
  test("uses the byline as the description for a short post", () => {
    expect(buildSocialPostText("👋", "Ada on Bluesky")).toEqual({
      title: "👋",
      description: "Ada on Bluesky",
    });
  });

  test("keeps right-to-left text as written", () => {
    expect(buildSocialPostText("مرحبا بالعالم", undefined).title).toBe(
      "مرحبا بالعالم"
    );
  });

  test("reads post HTML as text, decoding entities and dropping scripts", () => {
    expect(
      htmlToText(
        "<p>Fish &amp; chips &#x1F41F; &lt;3</p><script>steal()</script><style>p{}</style>"
      )
    ).toBe("Fish & chips 🐟 <3");
  });
});
