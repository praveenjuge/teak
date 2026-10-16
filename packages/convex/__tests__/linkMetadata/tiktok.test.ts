import { describe, expect, test } from "bun:test";
import {
  fetchTikTokVideo,
  isTikTokVideoUrl,
  parseTikTokVideoUrl,
  tikTokIdToIsoDate,
} from "../../linkMetadata/tiktok";
import {
  jsonResponse,
  socialFetch,
  socialFixture,
} from "../helpers/socialFetch.test-utils";

const VIDEO_URL = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const OEMBED_URL = `https://www.tiktok.com/oembed?url=${encodeURIComponent(VIDEO_URL)}`;

describe("parseTikTokVideoUrl", () => {
  test("reads the handle and id", () => {
    expect(parseTikTokVideoUrl(`${VIDEO_URL}?is_from_webapp=1`)).toEqual({
      handle: "scout2015",
      id: "6718335390845095173",
    });
  });

  test.each([
    "https://www.tiktok.com/@scout2015",
    "https://vm.tiktok.com/ZMabc123/",
    "https://www.tiktok.com/@scout2015/photo/6718335390845095173",
    "https://tiktok.example.com/@a/video/1",
  ])("ignores %s", (url: string) => {
    expect(isTikTokVideoUrl(url)).toBe(false);
  });
});

describe("tikTokIdToIsoDate", () => {
  test("reads the time a video id was made", () => {
    expect(tikTokIdToIsoDate("6718335390845095173")).toBe(
      "2019-07-27T13:32:33.000Z"
    );
  });

  test("ignores an id that isn't a number", () => {
    expect(tikTokIdToIsoDate("abc")).toBeUndefined();
  });
});

describe("fetchTikTokVideo", () => {
  test("reads the caption, author and cover image from oEmbed", async () => {
    const { deps, requests } = socialFetch((url) =>
      url === OEMBED_URL
        ? jsonResponse(socialFixture("tiktok-oembed.json"))
        : undefined
    );

    const post = await fetchTikTokVideo(VIDEO_URL, deps);

    expect(post).toMatchObject({
      title:
        "Scramble up ur name & I’ll try to guess it😍❤️ #foryoupage #petsoftiktok #aesthetic",
      description:
        "Scout, Suki & Stella (@scout2015) on TikTok · July 27, 2019",
      author: "Scout, Suki & Stella",
      publishedAt: "2019-07-27T13:32:33.000Z",
      siteName: "TikTok",
      platform: "tiktok",
      categoryHint: "social_post",
    });
    // The cover only: the video itself is not downloaded.
    expect(post?.media).toEqual([
      {
        type: "image",
        url: "https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/cover.jpeg",
        width: 720,
        height: 1280,
      },
    ]);
    expect(requests).toEqual([OEMBED_URL]);
  });

  test.each([400, 404, 429])(
    "returns null when oEmbed answers %d",
    async (status: number) => {
      const { deps } = socialFetch(() => new Response("", { status }));

      expect(await fetchTikTokVideo(VIDEO_URL, deps)).toBeNull();
    }
  );

  test("returns null for an answer that isn't JSON", async () => {
    const { deps } = socialFetch(() => new Response("<html></html>"));

    expect(await fetchTikTokVideo(VIDEO_URL, deps)).toBeNull();
  });
});
