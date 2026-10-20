import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AUDIO_WAVE_BARS,
  AudioWavePreview,
  getAudioWaveHeight,
  getWaveformBarHeights,
} from "../AudioWavePreview";

const grid = Array.from({ length: AUDIO_WAVE_BARS }, (_, i) => i * 2);
const fallback = Array.from({ length: AUDIO_WAVE_BARS }, (_, i) =>
  getAudioWaveHeight("card_a", i)
);

describe("AudioWavePreview", () => {
  test("renders a stable bar count keyed by card id", () => {
    const markup = renderToStaticMarkup(
      <AudioWavePreview cardId="card_audio_1" />
    );

    expect((markup.match(/width:2px/g) ?? []).length).toBe(AUDIO_WAVE_BARS);
  });

  test("names the recording and its length under the waveform", () => {
    const markup = renderToStaticMarkup(
      <AudioWavePreview
        cardId="card_audio_1"
        durationLabel="1:24"
        title="Standup notes.m4a"
      />
    );
    expect(markup).toContain("Standup notes.m4a");
    expect(markup).toContain("1:24");
  });

  test("produces deterministic heights for the same card id", () => {
    const first = renderToStaticMarkup(
      <AudioWavePreview cardId="stable-seed" />
    );
    const second = renderToStaticMarkup(
      <AudioWavePreview cardId="stable-seed" />
    );
    const other = renderToStaticMarkup(
      <AudioWavePreview cardId="other-seed" />
    );

    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  test("draws the real waveform when a valid grid is provided", () => {
    const markup = renderToStaticMarkup(
      <AudioWavePreview cardId="card_a" waveformGrid={grid} />
    );
    const fallbackMarkup = renderToStaticMarkup(
      <AudioWavePreview cardId="card_a" />
    );

    expect(markup).not.toBe(fallbackMarkup);
    expect(markup).toContain("height:10%");
    expect(markup).toContain("height:89.2%");
    expect((markup.match(/width:2px/g) ?? []).length).toBe(AUDIO_WAVE_BARS);
  });
});

describe("getWaveformBarHeights", () => {
  test("maps real values to visible percentage heights", () => {
    const heights = getWaveformBarHeights("card_a", grid);

    expect(heights).toHaveLength(AUDIO_WAVE_BARS);
    expect(heights[0]).toBe("10%");
    expect(heights.at(-1)).toBe("89.2%");
    expect(
      getWaveformBarHeights(
        "card_a",
        Array.from({ length: 45 }, () => 100)
      )[0]
    ).toBe("100%");
  });

  test.each([
    ["absent", undefined],
    ["too short", grid.slice(0, 44)],
    ["too long", [...grid, 50]],
    ["out of range", [...grid.slice(1), 101]],
    ["negative", [...grid.slice(1), -1]],
    ["non-finite", [...grid.slice(1), Number.NaN]],
    ["not an array", "nope"],
  ])("falls back to hash bars when the waveform is %s", (_, values) => {
    expect(getWaveformBarHeights("card_a", values)).toEqual(fallback);
  });

  test("honours a custom bar count and still falls back to 45 hash bars", () => {
    const detail = Array.from({ length: 200 }, () => 50);

    expect(getWaveformBarHeights("card_a", detail, 200)).toHaveLength(200);
    expect(getWaveformBarHeights("card_a", detail)).toEqual(fallback);
  });
});
