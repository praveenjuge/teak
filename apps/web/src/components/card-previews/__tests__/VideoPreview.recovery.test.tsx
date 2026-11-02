import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const refreshMediaUrl = mock(() =>
  Promise.resolve({ url: "https://files.teakvault.com/cards/clip-fresh.mp4" })
);
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => refreshMediaUrl,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { VideoPreview } = await import("../VideoPreview");

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  refreshMediaUrl.mockClear();
});

const render = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <VideoPreview
        card={
          {
            _id: "card_video",
            fileKey: "cards/clip.mp4",
            fileMetadata: { fileName: "clip.mp4", mimeType: "video/mp4" },
            fileUrl: "https://files.teakvault.com/cards/clip.mp4",
            type: "video",
          } as never
        }
      />
    )
  );
  return container;
};

test.each([
  ["while loading, on its source", "source"],
  ["mid-playback, on the video itself", "video"],
])(
  "a video whose link expired %s asks for a fresh one once",
  async (_when, target) => {
    const container = await render();
    await act(async () => {
      container.querySelector(target)?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector("source")?.getAttribute("src")).toBe(
      "https://files.teakvault.com/cards/clip-fresh.mp4?teak_retry=1"
    );
  }
);

test("a video whose link expired mid-playback carries on from the same moment", async () => {
  const play = mock(() => Promise.resolve());
  HTMLMediaElement.prototype.play = play;
  const container = await render();
  const old = container.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(old, "currentTime", {
    configurable: true,
    value: 42.5,
    writable: true,
  });
  Object.defineProperty(old, "paused", { configurable: true, value: false });
  await act(async () => {
    old.dispatchEvent(new Event("error"));
    await Promise.resolve();
  });

  const fresh = container.querySelector("video") as HTMLVideoElement;
  expect(fresh).not.toBe(old);
  await act(() => {
    fresh.dispatchEvent(new Event("loadedmetadata"));
  });
  expect(fresh.currentTime).toBe(42.5);
  expect(play).toHaveBeenCalled();

  // Only once: a later reload of the same link starts where it's told to.
  fresh.currentTime = 3;
  await act(() => {
    fresh.dispatchEvent(new Event("loadedmetadata"));
  });
  expect(fresh.currentTime).toBe(3);
});
