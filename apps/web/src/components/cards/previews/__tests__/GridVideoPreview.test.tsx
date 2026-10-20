import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../GridVideoPreview.tsx"),
  "utf8"
);

describe("GridVideoPreview", () => {
  test("reserves aspect ratio from width/height with a 16:9 fallback", () => {
    expect(source).toContain(
      "const aspectRatio = width && height ? width / height : 16 / 9"
    );
    expect(source).toContain("style={{ aspectRatio }}");
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
    expect(source).toContain('alt="GIF preview"');
  });

  test("shows a play overlay while idle and hides it while hovering", () => {
    expect(source).toContain("function PlayOverlay()");
    expect(source).toContain("{isHovering ? null : <PlayOverlay />}");
  });
});
