import { describe, expect, it } from "bun:test";
import { extractInstagramMediaFromHtml } from "../../linkMetadata/instagramHtml";

const POST_URL = "https://www.instagram.com/p/Cabc123_XyZ/";
const REEL_URL = "https://www.instagram.com/reel/Rdef456/?igsh=abc";
const CDN = "https://scontent.cdninstagram.com/v/t51";

const relayPage = (item: Record<string, unknown>, extraBody = "") => `
  <!doctype html><html><head>
    <meta property="og:image" content="${CDN}/og-fallback.jpg">
    <script type="application/json" data-sjs>
      ${JSON.stringify({
        require: [
          [
            "ScheduledServerJS",
            "handle",
            null,
            [
              {
                __bbox: {
                  result: {
                    data: {
                      xdt_api__v1__media__shortcode__web_info: {
                        items: [item],
                      },
                    },
                  },
                },
              },
            ],
          ],
        ],
      })}
    </script>
  </head><body>${extraBody}</body></html>`;

const candidates = (name: string) => [
  { url: `${CDN}/${name}-small.jpg?a=1&b=2`, width: 320, height: 320 },
  { url: `${CDN}/${name}-large.jpg?a=1&b=2`, width: 1080, height: 1080 },
  { url: `${CDN}/${name}-medium.jpg`, width: 640, height: 640 },
];

describe("extractInstagramMediaFromHtml: relay JSON", () => {
  it("extracts the largest image of a single image post", () => {
    const html = relayPage({
      code: "Cabc123_XyZ",
      image_versions2: { candidates: candidates("single") },
    });

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toEqual([
      {
        type: "image",
        url: `${CDN}/single-large.jpg?a=1&b=2`,
        contentType: "image/jpeg",
        width: 1080,
        height: 1080,
      },
    ]);
  });

  it("extracts a carousel with mixed images and videos in order", () => {
    const html = relayPage({
      code: "Cabc123_XyZ",
      carousel_media: [
        { image_versions2: { candidates: candidates("one") } },
        {
          image_versions2: { candidates: candidates("two") },
          video_versions: [
            {
              url: "https://video.fbcdn.net/two-low.mp4",
              width: 480,
              height: 480,
            },
            {
              url: "https://video.fbcdn.net/two-high.mp4",
              width: 1080,
              height: 1080,
            },
          ],
        },
        { image_versions2: { candidates: candidates("three") } },
      ],
    });

    const media = extractInstagramMediaFromHtml(POST_URL, html);

    expect(media?.map((item) => [item.type, item.url])).toEqual([
      ["image", `${CDN}/one-large.jpg?a=1&b=2`],
      ["video", "https://video.fbcdn.net/two-high.mp4"],
      ["image", `${CDN}/three-large.jpg?a=1&b=2`],
    ]);
    expect(media?.[1]).toMatchObject({
      contentType: "video/mp4",
      width: 1080,
      height: 1080,
      posterUrl: `${CDN}/two-large.jpg?a=1&b=2`,
      posterContentType: "image/jpeg",
      posterWidth: 1080,
      posterHeight: 1080,
    });
  });

  it("extracts a reel as a video with its poster image", () => {
    const html = relayPage({
      code: "Rdef456",
      image_versions2: { candidates: candidates("reel") },
      video_versions: [
        { url: "https://video.fbcdn.net/reel.mp4", width: 720, height: 1280 },
      ],
    });

    expect(extractInstagramMediaFromHtml(REEL_URL, html)).toEqual([
      {
        type: "video",
        url: "https://video.fbcdn.net/reel.mp4",
        contentType: "video/mp4",
        width: 720,
        height: 1280,
        posterUrl: `${CDN}/reel-large.jpg?a=1&b=2`,
        posterContentType: "image/jpeg",
        posterWidth: 1080,
        posterHeight: 1080,
      },
    ]);
  });

  it("ignores relay JSON for a different shortcode and falls back to the article", () => {
    const html = relayPage(
      {
        code: "SomeoneElse9",
        image_versions2: { candidates: candidates("other") },
      },
      `<article><img src="${CDN}/article.jpg" width="640" height="640"></article>`
    );

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toEqual([
      {
        type: "image",
        url: `${CDN}/article.jpg`,
        contentType: "image/jpeg",
        width: 640,
        height: 640,
      },
    ]);
  });

  it("returns undefined when the relay JSON does not match and there is no article", () => {
    const html = relayPage({
      code: "SomeoneElse9",
      image_versions2: { candidates: candidates("other") },
    });

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toBeUndefined();
  });

  it("skips an oversized script body without failing", () => {
    const padding = " ".repeat(2 * 1024 * 1024 + 1);
    const html = `<html><body>
      <script type="application/json">{"xdt_api__v1__media__shortcode__web_info":{"items":[{"code":"Cabc123_XyZ","image_versions2":{"candidates":[{"url":"${CDN}/huge.jpg","width":10,"height":10}]}}]}}${padding}</script>
      <article><img src="${CDN}/small-script-fallback.jpg" width="500" height="500"></article>
    </body></html>`;

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toEqual([
      {
        type: "image",
        url: `${CDN}/small-script-fallback.jpg`,
        contentType: "image/jpeg",
        width: 500,
        height: 500,
      },
    ]);
  });

  it("ignores a matching item nested beyond the depth limit and invalid JSON", () => {
    const item = {
      code: "Cabc123_XyZ",
      image_versions2: { candidates: candidates("deep") },
    };
    let nested: unknown = {
      xdt_api__v1__media__shortcode__web_info: { items: [item] },
    };
    for (let index = 0; index < 200; index += 1) {
      nested = { child: nested };
    }
    const html = `<html><body>
      <script type="application/json">xdt_api__v1__media__shortcode__web_info {not json</script>
      <script type="application/json">${JSON.stringify(nested)}</script>
    </body></html>`;

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toBeUndefined();
  });

  it("returns undefined for non-post URLs", () => {
    const html = relayPage({
      code: "Cabc123_XyZ",
      image_versions2: { candidates: candidates("single") },
    });

    expect(
      extractInstagramMediaFromHtml("https://www.instagram.com/someone/", html)
    ).toBeUndefined();
  });
});

describe("extractInstagramMediaFromHtml: static article fallback", () => {
  it("returns undefined for a login wall that only has og:image", () => {
    const html = `<html><head>
      <meta property="og:image" content="${CDN}/og-only.jpg">
      <title>Login • Instagram</title></head>
      <body><form><input name="username"></form></body></html>`;

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toBeUndefined();
  });

  it("ignores article images hosted outside Instagram's CDNs", () => {
    const html = `<html><body><article>
      <img src="https://evil.example.com/photo.jpg" width="800" height="800">
      <img src="https://notfbcdn.net/photo.jpg" width="800" height="800">
      <img src="http://scontent.cdninstagram.com/insecure.jpg" width="800" height="800">
      <video src="https://evil.example.com/clip.mp4"></video>
    </article></body></html>`;

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toBeUndefined();
  });

  it("skips profile pictures, header chrome and small images", () => {
    const html = `<html><body><article>
      <header><img src="${CDN}/header.jpg" width="900" height="900"></header>
      <img alt="someone's profile picture" src="${CDN}/avatar.jpg" width="900" height="900">
      <img src="${CDN}/thumb.jpg" width="64" height="64">
      <img src="${CDN}/anim.gif" width="900" height="900">
      <img src="${CDN}/main.jpg" srcset="${CDN}/main-320.jpg 320w, ${CDN}/main-1080.jpg 1080w">
    </article></body></html>`;

    expect(
      extractInstagramMediaFromHtml(POST_URL, html)?.map((item) => item.url)
    ).toEqual([`${CDN}/main-1080.jpg`]);
  });

  it("uses an article video with its poster", () => {
    const html = `<html><body><article>
      <video poster="${CDN}/poster.jpg" width="720" height="1280">
        <source src="https://video.fbcdn.net/clip.mp4" type="video/mp4">
      </video>
    </article></body></html>`;

    expect(extractInstagramMediaFromHtml(REEL_URL, html)).toEqual([
      {
        type: "video",
        url: "https://video.fbcdn.net/clip.mp4",
        contentType: "video/mp4",
        width: 720,
        height: 1280,
        posterUrl: `${CDN}/poster.jpg`,
        posterContentType: "image/jpeg",
        posterWidth: 720,
        posterHeight: 1280,
      },
    ]);
  });

  it("ignores media outside the article", () => {
    const html = `<html><body>
      <img src="${CDN}/outside.jpg" width="900" height="900">
    </body></html>`;

    expect(extractInstagramMediaFromHtml(POST_URL, html)).toBeUndefined();
  });
});
