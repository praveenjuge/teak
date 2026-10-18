import { describe, expect, test } from "bun:test";
import { fetchVideoCaptions } from "../../../../workflows/steps/captions/index";
import {
  chooseVimeoTrack,
  fetchVimeoCaptions,
  parseVimeoUrl,
  vimeoConfigUrl,
  vimeoTrackUrl,
} from "../../../../workflows/steps/captions/vimeo";
import {
  hangUntilAborted,
  jsonResponse,
  socialFetch,
} from "../../../helpers/socialFetch.test-utils";

const CONFIG = "https://player.vimeo.com/video/76979871/config";
const TRACK = "https://captions.vimeo.com/captions/140662.vtt?sig=x";
const VTT =
  "WEBVTT\n\n1\n00:00:05.237 --> 00:00:08.043\n<i>Here we make videos</i>\n<i>look good.</i>\n";

const config = (tracks: unknown[]) => ({ request: { text_tracks: tracks } });

const site = (answers: Record<string, () => Response>) =>
  socialFetch((url) => answers[url]?.());

describe("parseVimeoUrl", () => {
  test.each([
    ["https://vimeo.com/76979871", { id: "76979871" }],
    ["https://www.vimeo.com/76979871/", { id: "76979871" }],
    [
      "https://vimeo.com/76979871/1a2b3c4d5e",
      { hash: "1a2b3c4d5e", id: "76979871" },
    ],
    [
      "https://vimeo.com/76979871?h=1a2b3c4d5e",
      { hash: "1a2b3c4d5e", id: "76979871" },
    ],
    ["https://player.vimeo.com/video/76979871", { id: "76979871" }],
    [
      "https://player.vimeo.com/video/76979871?h=abcdef12",
      { hash: "abcdef12", id: "76979871" },
    ],
    ["https://vimeo.com/channels/staffpicks/76979871", { id: "76979871" }],
    ["https://vimeo.com/groups/shortfilms/videos/76979871", { id: "76979871" }],
  ])("reads %s", (url, ref) => {
    expect(parseVimeoUrl(url)).toEqual(ref);
  });

  test.each([
    "https://vimeo.com/",
    "https://vimeo.com/about",
    "https://vimeo.com/../76979871x",
    "https://vimeo.com/%2E%2E%2F76979871",
    `https://vimeo.com/${"1".repeat(200)}`,
    "https://player.vimeo.com/api/76979871",
    "https://vimeo.com.example.com/76979871",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "ftp://vimeo.com/76979871",
    "not a url",
  ])("ignores %s", (url) => {
    expect(parseVimeoUrl(url)).toBeNull();
  });

  test("drops a hash that isn't hex", () => {
    expect(parseVimeoUrl("https://vimeo.com/76979871?h=../../x")).toEqual({
      id: "76979871",
    });
  });

  test("an unlisted video's config carries its hash", () => {
    expect(vimeoConfigUrl({ hash: "1a2b3c4d5e", id: "76979871" })).toBe(
      `${CONFIG}?h=1a2b3c4d5e`
    );
  });
});

describe("chooseVimeoTrack", () => {
  const track = (fields: Record<string, unknown>) => ({
    url: TRACK,
    ...fields,
  });

  test("English, then the uploader's default, then the first", () => {
    expect(
      chooseVimeoTrack([
        track({ default: true, lang: "de" }),
        track({ lang: "en" }),
        track({ lang: "fr" }),
      ])?.lang
    ).toBe("en");
    expect(
      chooseVimeoTrack([
        track({ lang: "ja" }),
        track({ default: true, lang: "fr" }),
      ])?.lang
    ).toBe("fr");
    expect(
      chooseVimeoTrack([track({ lang: "de" }), track({ lang: "ja" })])?.lang
    ).toBe("de");
  });

  test("captions (the spoken language) before subtitles, a person before automatic", () => {
    expect(
      chooseVimeoTrack([
        track({ kind: "subtitles", lang: "en" }),
        track({ kind: "captions", lang: "ja" }),
      ])?.lang
    ).toBe("ja");
    expect(
      chooseVimeoTrack([
        track({ kind: "captions", lang: "en", provenance: "ai_generated" }),
        track({ kind: "subtitles", lang: "es" }),
      ])?.lang
    ).toBe("es");
  });

  test("a track without a file is skipped", () => {
    expect(chooseVimeoTrack([{ lang: "en" }])).toBeUndefined();
  });
});

describe("vimeoTrackUrl", () => {
  test.each([
    [TRACK, TRACK],
    [
      "/texttrack/1.vtt?token=x",
      "https://player.vimeo.com/texttrack/1.vtt?token=x",
    ],
    ["http://captions.vimeo.com/x.vtt", null],
    ["https://attacker.example/x.vtt", null],
    ["https://vimeo.com.attacker.example/x.vtt", null],
    [undefined, null],
  ])("%s is %s", (raw, expected) => {
    expect(vimeoTrackUrl(raw)).toBe(expected);
  });
});

describe("fetchVimeoCaptions", () => {
  test("reads the chosen track as the transcript", async () => {
    const { deps, requests } = site({
      [CONFIG]: () =>
        jsonResponse(
          config([
            {
              kind: "subtitles",
              lang: "de",
              url: "https://captions.vimeo.com/de.vtt",
            },
            { kind: "subtitles", lang: "en", url: TRACK },
          ])
        ),
      [TRACK]: () => new Response(VTT),
    });

    expect(await fetchVimeoCaptions({ id: "76979871" }, deps)).toEqual({
      captions: {
        auto: false,
        language: "en",
        text: "Here we make videos look good.",
      },
    });
    expect(requests).toEqual([CONFIG, TRACK]);
  });

  test.each([
    ["no tracks", () => jsonResponse(config([])), "no_captions"],
    [
      "a private video",
      () => new Response("Sorry", { status: 403 }),
      "blocked",
    ],
    [
      "a rate limit",
      () => new Response("Slow down", { status: 429 }),
      "blocked",
    ],
    [
      "a deleted video",
      () => new Response("Gone", { status: 404 }),
      "no_captions",
    ],
    ["a body that isn't JSON", () => new Response("<html>"), "parse_error"],
    [
      "a track off Vimeo",
      () =>
        jsonResponse(
          config([{ lang: "en", url: "https://attacker.example/x.vtt" }])
        ),
      "no_captions",
    ],
  ])("%s gives no transcript (%s)", async (_name, respond, reason) => {
    const { deps, requests } = site({ [CONFIG]: respond });

    expect<unknown>(await fetchVimeoCaptions({ id: "76979871" }, deps)).toEqual(
      { reason }
    );
    expect(requests).toEqual([CONFIG]);
  });

  test.each([
    ["isn't WebVTT", () => new Response("<html>Sorry</html>"), "parse_error"],
    ["is empty", () => new Response(""), "parse_error"],
    ["has no words", () => new Response("WEBVTT\n\n"), "no_captions"],
    ["is refused", () => new Response("no", { status: 403 }), "blocked"],
  ])("a track that %s gives no transcript", async (_name, respond, reason) => {
    const { deps } = site({
      [CONFIG]: () => jsonResponse(config([{ lang: "en", url: TRACK }])),
      [TRACK]: respond,
    });

    expect<unknown>(await fetchVimeoCaptions({ id: "76979871" }, deps)).toEqual(
      { reason }
    );
  });

  test("a redirect to a private address is refused", async () => {
    const { deps } = socialFetch(
      (url) =>
        url === CONFIG
          ? Response.redirect("https://internal.example/", 302)
          : undefined,
      { addresses: ["93.184.216.34"] }
    );
    const resolveDns = async (hostname: string) =>
      hostname === "internal.example" ? ["10.0.0.5"] : ["93.184.216.34"];

    expect(
      await fetchVimeoCaptions({ id: "76979871" }, { ...deps, resolveDns })
    ).toEqual({ reason: "unreachable" });
  });
});

describe("fetchVideoCaptions", () => {
  test("a request that never answers gives nothing", async () => {
    const { deps } = socialFetch((_url, init) => hangUntilAborted(init));

    expect(
      await fetchVideoCaptions("https://vimeo.com/76979871", {
        ...deps,
        timeoutMs: 20,
      })
    ).toBeNull();
  });

  test("a YouTube or any other link asks nothing", async () => {
    const { deps, requests } = site({});

    expect(
      await fetchVideoCaptions(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        deps
      )
    ).toBeNull();
    expect(
      await fetchVideoCaptions("https://example.com/talk", deps)
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  test("an unlisted video asks with its hash", async () => {
    const { deps, requests } = site({
      [`${CONFIG}?h=1a2b3c4d5e`]: () =>
        jsonResponse(config([{ lang: "en", url: TRACK }])),
      [TRACK]: () => new Response(VTT),
    });

    expect(
      (await fetchVideoCaptions("https://vimeo.com/76979871/1a2b3c4d5e", deps))
        ?.text
    ).toBe("Here we make videos look good.");
    expect(requests[0]).toBe(`${CONFIG}?h=1a2b3c4d5e`);
  });
});
