import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioPreview, formatAudioTime } from "../AudioPreview";

const createAudioCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_audio",
  _creationTime: Date.now(),
  content: "",
  createdAt: Date.now(),
  fileMetadata: {
    duration: 84,
    fileName: "Kickoff voice memo.m4a",
    mimeType: "audio/mp4",
  },
  fileUrl: "https://files.example.com/memo.m4a",
  isDeleted: false,
  isFavorited: false,
  type: "audio",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("formatAudioTime", () => {
  test("formats seconds as minutes and padded seconds", () => {
    expect(formatAudioTime(0)).toBe("0:00");
    expect(formatAudioTime(84.7)).toBe("1:24");
    expect(formatAudioTime(605)).toBe("10:05");
  });

  test("falls back to 0:00 for unknown durations", () => {
    expect(formatAudioTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatAudioTime(Number.NaN)).toBe("0:00");
  });
});

describe("AudioPreview", () => {
  test("renders a player with the stored duration, seek control, and file name", () => {
    const markup = renderToStaticMarkup(
      <AudioPreview card={createAudioCard() as any} />
    );

    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Seek"');
    expect(markup).toContain('max="84"');
    expect(markup).toContain(">1:24<");
    expect(markup).toContain('src="https://files.example.com/memo.m4a"');
    expect(markup).toContain("Kickoff voice memo.m4a");
  });

  test("disables seeking until the duration is known", () => {
    const markup = renderToStaticMarkup(
      <AudioPreview
        card={
          createAudioCard({ fileMetadata: { mimeType: "audio/webm" } }) as any
        }
      />
    );

    expect(markup).toMatch(/<input[^>]*aria-label="Seek"[^>]*disabled=""/);
  });

  test("shows the transcript below the player", () => {
    const markup = renderToStaticMarkup(
      <AudioPreview
        card={
          createAudioCard({
            aiTranscript: "Warmer colors, bolder wordmark.",
          }) as any
        }
      />
    );

    expect(markup).toContain("Transcript");
    expect(markup).toContain("Warmer colors, bolder wordmark.");
  });
});
