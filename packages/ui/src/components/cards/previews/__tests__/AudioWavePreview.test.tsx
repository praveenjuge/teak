import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AUDIO_WAVE_BARS, AudioWavePreview } from "../AudioWavePreview";

describe("AudioWavePreview", () => {
  test("renders a stable bar count keyed by card id", () => {
    const markup = renderToStaticMarkup(
      <AudioWavePreview cardId="card_audio_1" />
    );

    expect(
      (markup.match(/rounded-full bg-muted-foreground/g) ?? []).length
    ).toBe(AUDIO_WAVE_BARS);
    expect(markup).toContain("rounded-xl border bg-card");
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
});
