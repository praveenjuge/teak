import { afterEach, describe, expect, mock, test } from "bun:test";
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
const { GridVideoPreview } = await import("../GridVideoPreview");

let root: Root | undefined;
const realMatchMedia = window.matchMedia;
const play = mock(() => Promise.resolve());
HTMLMediaElement.prototype.play = play;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.matchMedia = realMatchMedia;
  play.mockClear();
});

const prefersReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query,
  })) as unknown as typeof window.matchMedia;
};

async function hoverPreview() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <GridVideoPreview
        cardId="card_video"
        height={90}
        thumbnailUrl="https://files.example.com/thumb.jpg"
        videoUrl="https://files.example.com/clip.mp4"
        width={160}
      />
    )
  );
  const surface = container.firstElementChild as HTMLElement;
  // React derives onMouseEnter from mouseover.
  await act(() => {
    surface.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  return container;
}

describe("a hovered video card", () => {
  test("plays the clip for someone who hasn't asked for less motion", async () => {
    prefersReducedMotion(false);
    const container = await hoverPreview();
    expect(container.querySelector("video")).not.toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
  });

  test("keeps the still and its play button under reduced motion", async () => {
    prefersReducedMotion(true);
    const container = await hoverPreview();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).not.toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});
