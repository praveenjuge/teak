import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
}));

const { GridVideoPreview } = await import("../GridVideoPreview");

const source = readFileSync(
  join(import.meta.dir, "../GridVideoPreview.tsx"),
  "utf8"
);

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

  test("defers every video mount until hover", () => {
    expect(source).toContain(
      "const [shouldLoadVideo, setShouldLoadVideo] = useState(false)"
    );
    expect(source).toContain("setShouldLoadVideo(true)");
    expect(source).toContain("setIsHovering(true)");
    expect(source).toContain("muted");
    expect(source).toContain("playsInline");
    expect(source).toContain("loop");
  });

  test("keeps GIF previews as images instead of video elements", () => {
    expect(source).toContain("if (isGif && videoUrl)");
    expect(source).toContain('alt={t("gifPreview")}');
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
