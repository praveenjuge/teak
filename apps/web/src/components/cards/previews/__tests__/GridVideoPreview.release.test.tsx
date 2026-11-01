import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () => mock(),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GridVideoPreview, HOVER_VIDEO_RELEASE_MS } = await import(
  "../GridVideoPreview"
);

let root: Root | undefined;
HTMLMediaElement.prototype.play = mock(() => Promise.resolve());
HTMLMediaElement.prototype.pause = mock();
HTMLMediaElement.prototype.load = mock();

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  setSystemTime();
});

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function renderPreview(thumbnailUrl?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <GridVideoPreview
        cardId="card_video"
        height={90}
        thumbnailUrl={thumbnailUrl}
        videoUrl="https://files.example.com/clip.mp4"
        width={160}
      />
    )
  );
  const surface = container.firstElementChild as HTMLElement;
  // React derives onMouseEnter and onMouseLeave from mouseover and mouseout.
  const hover = () =>
    act(() => {
      surface.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  const leave = () =>
    act(() => {
      surface.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        })
      );
    });
  return { container, hover, leave };
}

describe("a video card the pointer has left", () => {
  test("lets its video go once it's been still for a moment", async () => {
    const preview = await renderPreview("https://files.example.com/thumb.jpg");
    await preview.hover();
    const video = preview.container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(
      "https://files.example.com/clip.mp4"
    );
    await preview.leave();
    expect(preview.container.querySelector("video")).not.toBeNull();
    await wait(HOVER_VIDEO_RELEASE_MS + 50);
    expect(preview.container.querySelector("video")).toBeNull();
    // Its source is dropped, so the browser frees what it buffered.
    expect(video?.hasAttribute("src")).toBe(false);
    expect(preview.container.querySelector("img")).not.toBeNull();
  });

  test("keeps playing the same video when the pointer comes straight back", async () => {
    const preview = await renderPreview("https://files.example.com/thumb.jpg");
    await preview.hover();
    const video = preview.container.querySelector("video");
    await preview.leave();
    await wait(HOVER_VIDEO_RELEASE_MS / 2);
    await preview.hover();
    await wait(HOVER_VIDEO_RELEASE_MS);
    expect(preview.container.querySelector("video")).toBe(video);
  });

  test("keeps the video when its first frame is the card's only picture", async () => {
    const preview = await renderPreview();
    await preview.hover();
    await preview.leave();
    await wait(HOVER_VIDEO_RELEASE_MS + 50);
    expect(preview.container.querySelector("video")).not.toBeNull();
  });
});
