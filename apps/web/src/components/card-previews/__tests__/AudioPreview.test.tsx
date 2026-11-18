import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const refreshMediaUrl = mock(() =>
  Promise.resolve({ url: "https://files.teakvault.com/cards/memo-fresh.m4a" })
);
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => refreshMediaUrl,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AudioPreview } = await import("../AudioPreview");

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

  test("shows an hour-long recording's length with its hours, as its card does", () => {
    const markup = renderToStaticMarkup(
      <AudioPreview
        card={
          createAudioCard({
            fileMetadata: { duration: 4500.6, mimeType: "audio/mp4" },
          }) as any
        }
      />
    );
    expect(markup).toContain(">1:15:00<");
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

  test("draws the 200-bar detail waveform when present", () => {
    const detail = Array.from({ length: 200 }, (_, i) => i % 101);
    const markup = renderToStaticMarkup(
      <AudioPreview
        card={
          createAudioCard({
            fileMetadata: {
              duration: 84,
              waveform: { detail, grid: new Array(45).fill(50) },
            },
          }) as any
        }
      />
    );

    expect((markup.match(/<span aria-hidden="true"/g) ?? []).length).toBe(200);
    expect(markup).toContain("height:100%");
    expect(markup).toContain("height:10%");
  });

  test("falls back to the 45 placeholder bars for an invalid waveform", () => {
    const markup = renderToStaticMarkup(
      <AudioPreview
        card={
          createAudioCard({
            fileMetadata: {
              duration: 84,
              waveform: { detail: [1, 2, 3], grid: [] },
            },
          }) as any
        }
      />
    );

    expect((markup.match(/<span aria-hidden="true"/g) ?? []).length).toBe(45);
  });
});

describe("AudioPreview playback progress", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  test("the seek bar and the time follow playback", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <AudioPreview
          card={
            createAudioCard({
              fileMetadata: {
                duration: 100,
                waveform: {
                  detail: Array.from({ length: 200 }, () => 50),
                  grid: new Array(45).fill(50),
                },
              },
            }) as any
          }
        />
      )
    );
    const seek = () =>
      container.querySelector<HTMLInputElement>('input[aria-label="Seek"]');
    expect(seek()?.value).toBe("0");

    const audio = container.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      value: 25,
    });
    await act(() => {
      audio.dispatchEvent(new Event("timeupdate"));
    });

    expect(seek()?.value).toBe("25");
    expect(container.textContent).toContain("0:25 / 1:40");
  });
});

describe("AudioPreview in a dialog left open", () => {
  let openRoot: Root | undefined;
  afterEach(async () => {
    await act(() => openRoot?.unmount());
    openRoot = undefined;
    document.body.innerHTML = "";
  });

  test("asks for a fresh URL once before saying the recording can't play", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    openRoot = createRoot(container);
    await act(() =>
      openRoot?.render(
        <AudioPreview
          card={
            createAudioCard({
              fileKey: "cards/memo.m4a",
              fileUrl: "https://files.teakvault.com/cards/memo.m4a",
            }) as any
          }
        />
      )
    );
    const audio = () => container.querySelector("audio") as HTMLAudioElement;
    await act(async () => {
      audio().dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
    expect(audio().getAttribute("src")).toBe(
      "https://files.teakvault.com/cards/memo-fresh.m4a?teak_retry=1"
    );
    expect(container.querySelector('[role="status"]')).toBeNull();

    await act(async () => {
      audio().dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});
