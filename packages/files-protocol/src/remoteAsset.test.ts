import { expect, test } from "bun:test";
import { GENERIC_MEDIA_TYPES } from "./mediaTypes";
import { resolveRemoteAssetContentType } from "./remoteAsset";

test.each([...GENERIC_MEDIA_TYPES].filter(Boolean))(
  "a host's %p says nothing, so the URL decides",
  (generic) => {
    expect(
      resolveRemoteAssetContentType(generic, "https://cdn.example/a.PNG?x=1")
    ).toBe("image/png");
  }
);

test("application/binary is as generic as octet-stream", () => {
  expect(
    resolveRemoteAssetContentType(
      "application/binary; charset=binary",
      "https://cdn.example/clip.mp4"
    )
  ).toBe("video/mp4");
});

test.each([
  ["Image/WebP; q=1", "https://cdn.example/a", "image/webp"],
  [null, "https://cdn.example/photo.jpg#top", "image/jpeg"],
  [null, "https://cdn.example/photo.jpeg", "image/jpeg"],
  [null, "https://cdn.example/logo.svg", "image/svg+xml"],
  [null, "https://cdn.example/clip.mov", "video/quicktime"],
  [null, "https://cdn.example/page.html", null],
])("%p from %p is %p", (header, url, expected) => {
  expect(resolveRemoteAssetContentType(header, url)).toBe(expected);
});
