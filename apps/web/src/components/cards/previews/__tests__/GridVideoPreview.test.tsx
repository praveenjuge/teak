import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { GridVideoPreview } = await import("../GridVideoPreview");

describe("GridVideoPreview", () => {
  test("keeps a video's own shape between 3:4 and 16:9, with a 16:9 fallback", () => {
    const shape = (width?: number, height?: number) =>
      renderToStaticMarkup(
        <GridVideoPreview
          height={height}
          thumbnailUrl="https://files.teakvault.com/still.jpg"
          width={width}
        />
      ).match(/aspect-ratio:([0-9.]+)/)?.[1];
    expect(Number(shape(800, 600))).toBeCloseTo(4 / 3);
    expect(Number(shape(400, 1200))).toBeCloseTo(3 / 4);
    expect(Number(shape(3000, 500))).toBeCloseTo(16 / 9);
    expect(Number(shape())).toBeCloseTo(16 / 9);
  });

  test("shows its still, not the video, until it is hovered", () => {
    const markup = renderToStaticMarkup(
      <GridVideoPreview
        thumbnailUrl="https://files.teakvault.com/still.jpg"
        videoUrl="https://files.teakvault.com/clip.mp4"
      />
    );
    expect(markup).not.toContain("<video");
    expect(markup).toContain("still.jpg");
  });

  test("shows a GIF as an image, never a video", () => {
    const markup = renderToStaticMarkup(
      <GridVideoPreview isGif videoUrl="https://files.teakvault.com/a.gif" />
    );
    expect(markup).not.toContain("<video");
    expect(markup).toMatch(/<img[^>]*a\.gif/);
  });

  test("shows its length in the play badge while idle", () => {
    const markup = renderToStaticMarkup(
      <GridVideoPreview
        durationLabel="0:42"
        thumbnailUrl="https://files.teakvault.com/still.jpg"
      />
    );
    expect(markup).toMatch(
      /bottom-2\.5 left-2\.5[^>]*><svg[\s\S]*?<\/svg>0:42</
    );
  });
});
