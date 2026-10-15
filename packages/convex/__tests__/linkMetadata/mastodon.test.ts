import { describe, expect, test } from "bun:test";
import {
  fetchMastodonStatus,
  isMastodonStatusUrl,
  parseMastodonStatusUrl,
} from "../../linkMetadata/mastodon";
import {
  hangUntilAborted,
  jsonResponse,
  socialFetch,
  socialFixture,
} from "../helpers/socialFetch.test-utils";

const STATUS_URL = "https://mastodon.social/@Gargron/109311046116149744";
const API_URL = "https://mastodon.social/api/v1/statuses/109311046116149744";

const instance = (status: unknown = socialFixture("mastodon-status.json")) =>
  socialFetch((url) => (url === API_URL ? jsonResponse(status) : undefined));

describe("parseMastodonStatusUrl", () => {
  test.each([
    [
      STATUS_URL,
      {
        origin: "https://mastodon.social",
        user: "Gargron",
        id: "109311046116149744",
      },
    ],
    [
      "https://social.example.org:8443/@alice/42/",
      { origin: "https://social.example.org:8443", user: "alice", id: "42" },
    ],
  ])("reads %s", (url: string, ref: unknown) => {
    expect(parseMastodonStatusUrl(url)).toEqual(ref);
  });

  test.each([
    "https://mastodon.social/@Gargron",
    "https://mastodon.social/@Gargron/109311046116149744/reblogs",
    "https://mastodon.social/@alice@other.example/42",
    "https://mastodon.social/users/Gargron/statuses/42",
    "http://mastodon.social/@Gargron/42",
  ])("ignores %s", (url: string) => {
    expect(isMastodonStatusUrl(url)).toBe(false);
  });
});

describe("fetchMastodonStatus", () => {
  test("reads the status with its warning, author, date and media", async () => {
    const { deps, requests } = instance();

    const post = await fetchMastodonStatus(STATUS_URL, deps);

    expect(post).toMatchObject({
      title:
        "CW: Spoilers for the finale It was the butler & the cook. Line two line three #tv",
      description:
        "Eugen Rochko (@Gargron@mastodon.social) on Mastodon · November 9, 2022",
      author: "Eugen Rochko",
      publishedAt: "2022-11-09T12:00:00.000Z",
      siteName: "Mastodon",
      platform: "mastodon",
      categoryHint: "social_post",
    });
    // The image, the gifv as an MP4 with its poster, and only the preview of
    // a streamed video; audio is skipped.
    expect(post?.media).toEqual([
      {
        type: "image",
        url: "https://files.mastodon.social/media_attachments/files/1/original/photo.jpg",
        width: 1600,
        height: 900,
      },
      {
        type: "video",
        url: "https://files.mastodon.social/media_attachments/files/2/original/loop.mp4",
        contentType: "video/mp4",
        width: 480,
        height: 270,
        posterUrl:
          "https://files.mastodon.social/media_attachments/files/2/small/loop.png",
        posterWidth: 400,
        posterHeight: 225,
      },
      {
        type: "image",
        url: "https://files.mastodon.social/media_attachments/files/3/small/clip.png",
      },
    ]);
    expect(requests).toEqual([API_URL]);
  });

  test("drops scripts in the content instead of keeping their code", async () => {
    const { deps } = instance();

    const post = await fetchMastodonStatus(STATUS_URL, deps);

    expect(post?.title).not.toContain("alert");
    expect(post?.title).not.toContain("<");
  });

  test("confirms a status on any instance", async () => {
    const status = {
      ...socialFixture<Record<string, unknown>>("mastodon-status.json"),
      id: "42",
      url: "https://social.example.org/@alice/42",
      account: { acct: "alice", display_name: "" },
      spoiler_text: "",
    };
    const { deps } = socialFetch((url) =>
      url === "https://social.example.org/api/v1/statuses/42"
        ? jsonResponse(status)
        : undefined
    );

    const post = await fetchMastodonStatus(
      "https://social.example.org/@alice/42",
      deps
    );

    expect(post?.author).toBe("@alice@social.example.org");
    expect(post?.categoryHint).toBe("social_post");
  });

  test("refuses an answer about a different status", async () => {
    const { deps } = instance({
      ...socialFixture<Record<string, unknown>>("mastodon-status.json"),
      url: "https://mastodon.social/@someone/1",
    });

    expect(await fetchMastodonStatus(STATUS_URL, deps)).toBeNull();
  });

  test("returns null for a blog page that only looks like a status", async () => {
    const { deps } = socialFetch(
      () =>
        new Response("<html>a blog</html>", {
          headers: { "content-type": "text/html" },
        })
    );

    expect(
      await fetchMastodonStatus("https://blog.example.com/@alice/123", deps)
    ).toBeNull();
  });

  test.each([404, 429, 500])(
    "returns null when the instance answers %d",
    async (status: number) => {
      const { deps } = socialFetch(() => new Response("nope", { status }));

      expect(await fetchMastodonStatus(STATUS_URL, deps)).toBeNull();
    }
  );

  test("returns null when the instance times out", async () => {
    const { deps } = socialFetch((_url, init) => hangUntilAborted(init));

    expect(
      await fetchMastodonStatus(STATUS_URL, { ...deps, timeoutMs: 20 })
    ).toBeNull();
  });

  test("returns null for an answer over 1 MiB", async () => {
    const { deps } = instance({ padding: "x".repeat(10 * 1024 * 1024) });

    expect(await fetchMastodonStatus(STATUS_URL, deps)).toBeNull();
  });

  test("keeps at most ten media items", async () => {
    const status = socialFixture("mastodon-status.json");
    status.media_attachments = Array.from({ length: 14 }, (_, index) => ({
      type: "image",
      url: `https://files.mastodon.social/${index}.jpg`,
    }));
    const { deps } = instance(status);

    const post = await fetchMastodonStatus(STATUS_URL, deps);

    expect(post?.media).toHaveLength(10);
  });
});

describe("Mastodon requests and the SSRF guard", () => {
  test.each([
    "https://127.0.0.1/@alice/42",
    "https://[::1]/@alice/42",
    "https://169.254.169.254/@alice/42",
  ])("never asks %s", async (url: string) => {
    const { deps, requests } = socialFetch(() => jsonResponse({}));

    expect(await fetchMastodonStatus(url, deps)).toBeNull();
    expect(requests).toEqual([]);
  });

  test("never asks an instance whose name resolves to a private address", async () => {
    const { deps, requests } = socialFetch(() => jsonResponse({}), {
      addresses: ["10.0.0.5"],
    });

    expect(
      await fetchMastodonStatus("https://internal.example/@alice/42", deps)
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  test("does not follow a redirect to the metadata service", async () => {
    const { deps, requests } = socialFetch((url) =>
      url === API_URL
        ? Response.redirect("http://169.254.169.254/latest/meta-data", 302)
        : jsonResponse(socialFixture("mastodon-status.json"))
    );

    expect(await fetchMastodonStatus(STATUS_URL, deps)).toBeNull();
    expect(requests).toEqual([API_URL]);
  });
});
