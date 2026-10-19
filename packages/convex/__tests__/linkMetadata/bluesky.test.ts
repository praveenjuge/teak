import { describe, expect, test } from "bun:test";
import {
  fetchBlueskyPost,
  isBlueskyPostUrl,
  parseBlueskyPostUrl,
} from "../../linkMetadata/bluesky";
import {
  hangUntilAborted,
  jsonResponse,
  socialFetch,
  socialFixture,
} from "../helpers/socialFetch.test-utils";

const POST_URL = "https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l";
const DID = "did:plc:z72i7hdynmk6r22z27h6tvur";
const RESOLVE =
  "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle";
const THREAD = "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread";

const appView = (thread: unknown, did = DID) =>
  socialFetch((url) => {
    if (url.startsWith(RESOLVE)) {
      return jsonResponse({ did });
    }
    if (url.startsWith(THREAD)) {
      return jsonResponse(thread);
    }
  });

describe("parseBlueskyPostUrl", () => {
  test.each([
    [POST_URL, { actor: "bsky.app", rkey: "3l6oveex3ii2l" }],
    [
      "https://bsky.app/profile/did:plc:abc/post/3kabc/",
      { actor: "did:plc:abc", rkey: "3kabc" },
    ],
    [
      "https://www.bsky.app/profile/a.example.com/post/3kabc?ref=1",
      { actor: "a.example.com", rkey: "3kabc" },
    ],
  ])("reads %s", (url: string, ref: unknown) => {
    expect<unknown>(parseBlueskyPostUrl(url)).toEqual(ref);
  });

  test.each([
    "https://bsky.app/profile/bsky.app",
    "https://bsky.app/profile/bsky.app/post/abc/liked-by",
    "https://example.com/profile/bsky.app/post/3kabc",
    "not a url",
  ])("ignores %s", (url: string) => {
    expect(isBlueskyPostUrl(url)).toBe(false);
  });
});

describe("fetchBlueskyPost", () => {
  test("reads the text, author, date and full-size images", async () => {
    const { deps, requests } = appView(socialFixture("bluesky-images.json"));

    const post = await fetchBlueskyPost(POST_URL, deps);

    expect(post).toMatchObject({
      title: "Four photos from the launch party 🎉",
      description: "Bluesky (@bsky.app) on Bluesky · October 15, 2024",
      author: "Bluesky",
      publishedAt: "2024-10-15T17:30:00.000Z",
      siteName: "Bluesky",
      platform: "bluesky",
      categoryHint: "social_post",
      finalUrl: POST_URL,
    });
    expect(post?.media?.map((item) => item.url)).toEqual([
      "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72/a@jpeg",
      "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72/b@jpeg",
      "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72/c@jpeg",
      "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72/d@jpeg",
    ]);
    expect(post?.media?.[0]).toMatchObject({ width: 2000, height: 1500 });
    expect(requests).toHaveLength(2);
    const threadUrl = new URL(requests[1] as string);
    expect(threadUrl.searchParams.get("uri")).toBe(
      `at://${DID}/app.bsky.feed.post/3l6oveex3ii2l`
    );
    expect(threadUrl.searchParams.get("depth")).toBe("0");
    expect(threadUrl.searchParams.get("parentHeight")).toBe("0");
  });

  test("keeps only the thumbnail of a video in a quote post", async () => {
    const { deps } = appView(socialFixture("bluesky-video-quote.json"));

    const post = await fetchBlueskyPost(
      "https://bsky.app/profile/alice.example.com/post/3kvideo",
      deps
    );

    expect(post?.title).toBe("Quoting with a clip");
    expect(post?.media).toEqual([
      {
        type: "image",
        url: "https://video.bsky.app/watch/did%3Aplc%3Aabc/bafkvideo/thumbnail.jpg",
        contentType: "image/jpeg",
        width: 1080,
        height: 1920,
      },
    ]);
  });

  test("skips the handle lookup for a did URL", async () => {
    const { deps, requests } = appView(socialFixture("bluesky-images.json"));

    await fetchBlueskyPost(`https://bsky.app/profile/${DID}/post/3l6o`, deps);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toStartWith(THREAD);
  });

  test("puts a long post's whole text in the description", async () => {
    const thread = socialFixture("bluesky-images.json");
    const text = "word ".repeat(200).trim();
    thread.thread.post.record.text = text;
    const { deps } = appView(thread);

    const post = await fetchBlueskyPost(POST_URL, deps);

    expect(post?.title).toHaveLength(512);
    expect(post?.description).toBe(text);
  });

  test("returns null for a post its author keeps from logged-out viewers", async () => {
    const thread = socialFixture("bluesky-images.json");
    thread.thread.post.author.labels = [{ val: "!no-unauthenticated" }];
    const { deps } = appView(thread);

    expect(await fetchBlueskyPost(POST_URL, deps)).toBeNull();
  });

  test("returns null for a deleted post", async () => {
    const { deps } = appView({
      thread: {
        $type: "app.bsky.feed.defs#notFoundPost",
        uri: "at://x",
        notFound: true,
      },
    });

    expect(await fetchBlueskyPost(POST_URL, deps)).toBeNull();
  });

  test("returns null when the handle does not resolve", async () => {
    const { deps, requests } = socialFetch((url) =>
      url.startsWith(RESOLVE)
        ? jsonResponse({ error: "InvalidRequest" }, { status: 400 })
        : undefined
    );

    expect(await fetchBlueskyPost(POST_URL, deps)).toBeNull();
    expect(requests).toHaveLength(1);
  });

  test.each([429, 500])(
    "returns null when the API answers %d",
    async (status: number) => {
      const { deps } = socialFetch((url) =>
        url.startsWith(RESOLVE)
          ? jsonResponse({ did: DID })
          : new Response("busy", { status })
      );

      expect(await fetchBlueskyPost(POST_URL, deps)).toBeNull();
    }
  );

  test("returns null when the API times out", async () => {
    const { deps } = socialFetch((_url, init) => hangUntilAborted(init));

    expect(
      await fetchBlueskyPost(POST_URL, { ...deps, timeoutMs: 20 })
    ).toBeNull();
  });

  test("returns null when the thread is larger than 1 MiB", async () => {
    const { deps } = appView({ padding: "x".repeat(1024 * 1024) });

    expect(await fetchBlueskyPost(POST_URL, deps)).toBeNull();
  });
});
