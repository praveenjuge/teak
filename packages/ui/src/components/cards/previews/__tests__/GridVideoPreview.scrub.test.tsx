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
const { GridVideoPreview, scrubFrameIndex } = await import(
  "../GridVideoPreview"
);

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const SCRUB = { frames: 10, frameHeight: 90, frameWidth: 160 };

async function renderPreview(props: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <GridVideoPreview
        cardId="card_video"
        height={90}
        scrub={SCRUB}
        scrubUrl="https://files.example.com/scrub.jpg"
        thumbnailUrl="https://files.example.com/thumb.jpg"
        videoUrl="https://files.example.com/clip.mp4"
        width={160}
        {...props}
      />
    )
  );
  const surface = container.firstElementChild as HTMLElement;
  // happy-dom has no layout; the strip is 200px wide starting at x = 100.
  surface.getBoundingClientRect = () =>
    ({ left: 100, width: 200, top: 0, height: 112 }) as DOMRect;
  return { container, surface };
}

// React derives onPointerEnter/Leave from pointerover/pointerout.
const pointer = async (
  surface: HTMLElement,
  type: "pointerover" | "pointermove" | "pointerout",
  pointerType: string,
  clientX = 100
) => {
  await act(() => {
    surface.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, pointerType })
    );
  });
};

const sprite = (container: HTMLElement) =>
  container.querySelector<HTMLImageElement>('img[src$="scrub.jpg"]');

describe("scrubFrameIndex", () => {
  test.each([
    [0, 200, 10, 0],
    [19, 200, 10, 0],
    [20, 200, 10, 1],
    [100, 200, 10, 5],
    [199, 200, 10, 9],
  ])("maps x=%p of %p to frame %p of %p", (x, width, frames, expected) => {
    expect(scrubFrameIndex(x, width, frames)).toBe(expected);
  });

  test("clamps outside the strip", () => {
    expect(scrubFrameIndex(-50, 200, 10)).toBe(0);
    expect(scrubFrameIndex(200, 200, 10)).toBe(9);
    expect(scrubFrameIndex(5000, 200, 10)).toBe(9);
  });

  test("is safe for zero width and degenerate input", () => {
    expect(scrubFrameIndex(10, 0, 10)).toBe(0);
    expect(scrubFrameIndex(Number.NaN, 200, 10)).toBe(0);
    expect(scrubFrameIndex(10, 200, 1)).toBe(0);
    expect(scrubFrameIndex(10, 200, 0)).toBe(0);
  });
});

describe("GridVideoPreview scrubbing", () => {
  test("does not request the sprite before the first hover", async () => {
    const { container } = await renderPreview();

    expect(sprite(container)).toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('img[src$="thumb.jpg"]')).not.toBeNull();
  });

  test.each(["touch", "pen"])(
    "%s pointers keep the static thumbnail",
    async (type) => {
      const { container, surface } = await renderPreview();

      await pointer(surface, "pointerover", type);
      await pointer(surface, "pointermove", type, 250);

      expect(sprite(container)).toBeNull();
    }
  );

  test("a mouse mounts the sprite and shifts it to the frame under the pointer", async () => {
    const { container, surface } = await renderPreview();

    await pointer(surface, "pointerover", "mouse", 100);
    const first = sprite(container);
    expect(first).not.toBeNull();
    expect(first?.style.width).toBe("1000%");
    expect(first?.style.transform).toBe("translateX(-0%)");

    await pointer(surface, "pointermove", "mouse", 200);
    expect(sprite(container)?.style.transform).toBe("translateX(-50%)");

    await pointer(surface, "pointermove", "mouse", 299);
    expect(sprite(container)?.style.transform).toBe("translateX(-90%)");
  });

  test("leaving resets to the first frame and hides the sprite", async () => {
    const { container, surface } = await renderPreview();

    await pointer(surface, "pointerover", "mouse", 100);
    await pointer(surface, "pointermove", "mouse", 250);
    await act(() => {
      sprite(container)?.dispatchEvent(new Event("load"));
    });
    expect(sprite(container)?.className).not.toContain("opacity-0");

    await pointer(surface, "pointerout", "mouse");

    expect(sprite(container)?.className).toContain("opacity-0");
    expect(sprite(container)?.style.transform).toBe("translateX(-0%)");
  });

  test("falls back to hover video without scrub data", async () => {
    const { container, surface } = await renderPreview({
      scrub: undefined,
      scrubUrl: undefined,
    });

    await pointer(surface, "pointerover", "mouse");

    expect(sprite(container)).toBeNull();
  });
});
