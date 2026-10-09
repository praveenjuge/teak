import { describe, expect, test } from "bun:test";
import { getAudioWaveHeight } from "../../../../packages/ui/src/components/cards/previews/AudioWavePreview";
import {
  distributeIntoColumns,
  estimateTileHeight,
  getGridColumnCount,
  getTileImageRatio,
  getTileImageUrl,
  getWaveformHeights,
} from "../../lib/card-grid";

const summary = (overrides: Record<string, unknown>) =>
  ({
    _creationTime: 1,
    _id: "card",
    title: "Card",
    type: "text",
    ...overrides,
  }) as any;

describe("card grid", () => {
  test("uses two columns on phones and more on wider windows", () => {
    expect(getGridColumnCount(402)).toBe(2);
    expect(getGridColumnCount(820)).toBe(3);
    expect(getGridColumnCount(1180)).toBe(4);
  });

  test("places each tile in the shortest column", () => {
    const columns = distributeIntoColumns([300, 100, 100, 100], 2, (h) => h, 0);
    expect(columns).toEqual([[300], [100, 100, 100]]);
  });

  test("prefers the link preview image and falls back to the screenshot", () => {
    expect(
      getTileImageUrl(
        summary({
          type: "link",
          linkPreviewImageUrl: "og",
          screenshotUrl: "shot",
        })
      )
    ).toBe("og");
    expect(
      getTileImageUrl(summary({ type: "link", screenshotUrl: "shot" }))
    ).toBe("shot");
    expect(getTileImageUrl(summary({ type: "text", thumbnailUrl: "x" }))).toBe(
      undefined
    );
  });

  test("sizes media from its aspect ratio and clamps extreme shapes", () => {
    expect(getTileImageRatio(summary({ type: "image", aspectRatio: 2 }))).toBe(
      2
    );
    expect(
      getTileImageRatio(summary({ type: "image", aspectRatio: 0.1 }))
    ).toBe(0.5);
    expect(getTileImageRatio(summary({ type: "link" }))).toBeCloseTo(1.91);
    const tall = estimateTileHeight(
      summary({ type: "image", aspectRatio: 0.5, compactUrl: "x" }),
      180
    );
    expect(tall).toBe(360);
  });

  test("draws the same waveform as the web card", () => {
    const heights = getWaveformHeights("k17abc123");
    expect(heights).toHaveLength(45);
    heights.forEach((height, index) => {
      expect(height * 60 + 20).toBeCloseTo(
        Number.parseFloat(getAudioWaveHeight("k17abc123", index)),
        2
      );
    });
  });
});
