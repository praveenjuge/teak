import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const refreshMediaUrl = mock(() =>
  Promise.resolve({ url: "https://files.teakvault.com/cards/photo-fresh.jpg" })
);
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => refreshMediaUrl,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ImagePreview } = await import("../ImagePreview");

const createImageCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_image",
  _creationTime: Date.now(),
  content: "Moodboard",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  type: "image",
  updatedAt: Date.now(),
  userId: "user_123",
  ...overrides,
});

describe("ImagePreview", () => {
  test.each([
    [{ content: "Moodboard" }, "Moodboard"],
    [
      { content: "", aiSummary: "A red tulip in a glass vase" },
      "A red tulip in a glass vase",
    ],
    [{ content: "", fileMetadata: { fileName: "tulip.jpg" } }, "tulip.jpg"],
    [{ content: "  " }, "Image"],
  ])("names the image by what it shows: %o", (overrides, alt) => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/photo.jpg",
            ...overrides,
          }) as any
        }
      />
    );
    expect(markup).toContain(`alt="${alt}"`);
  });

  test("shows a fallback when no image URL is available", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileMetadata: { fileName: "shot.png" },
          }) as any
        }
      />
    );

    expect(markup).toContain("shot.png");
  });

  test("renders the file URL for standard images", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/photo.jpg",
            fileMetadata: { width: 1200, height: 800, fileName: "photo.jpg" },
          }) as any
        }
      />
    );

    expect(markup).toContain('src="https://cdn.example.com/photo.jpg"');
    expect(markup).toContain('data-fit="contain"');
  });

  test("uses thumbnail derivatives for HEIC and tall-image layout", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/original.heic",
            thumbnailUrl: "https://cdn.example.com/thumb.jpg",
            fileMetadata: {
              fileName: "original.heic",
              mimeType: "image/heic",
              width: 800,
              height: 1600,
            },
          }) as any
        }
      />
    );

    expect(markup).toContain("thumb.jpg");
    expect(markup).toContain('data-fit="width"');
    expect(markup).not.toContain("original.heic");
  });

  test("renders a tall image full width so the modal scrolls down it", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/tall.jpg",
            fileMetadata: { width: 800, height: 2400 },
          }) as any
        }
      />
    );

    expect(markup).toContain('data-fit="width"');
    expect(markup).not.toContain('data-fit="contain"');
  });

  test("leaves the image's palette to the side panel", () => {
    const markup = renderToStaticMarkup(
      <ImagePreview
        card={
          createImageCard({
            fileUrl: "https://cdn.example.com/photo.jpg",
            fileMetadata: { width: 1200, height: 800 },
            colors: [{ hex: "#112233" }, { hex: "#445566" }],
          }) as any
        }
      />
    );

    expect(markup).not.toContain("#112233");
    expect(markup).not.toContain("#445566");
  });
});

describe("ImagePreview in a dialog left open", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  test("asks for a fresh URL once the old one has expired, then says it's unavailable", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <ImagePreview
          card={
            createImageCard({
              fileKey: "cards/photo.jpg",
              fileMetadata: { fileName: "photo.jpg" },
              fileUrl: "https://files.teakvault.com/cards/photo.jpg",
            }) as never
          }
        />
      )
    );
    const img = () => container.querySelector("img");
    await act(async () => {
      img()?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
    expect(img()?.getAttribute("src")).toBe(
      "https://files.teakvault.com/cards/photo-fresh.jpg?teak_retry=1"
    );

    await act(async () => {
      img()?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    });
    expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
    expect(img()).toBeNull();
    expect(container.textContent).toBe("photo.jpg");
  });
  test("pulses in the image's box until the image has loaded", async () => {
    const container = document.createElement("div");
    const root: Root = createRoot(container);
    await act(() =>
      root.render(
        <ImagePreview
          card={
            createImageCard({
              fileUrl: "https://cdn.example.com/photo.jpg",
              fileMetadata: { width: 1200, height: 800 },
            }) as any
          }
        />
      )
    );
    const image = container.querySelector("img") as HTMLImageElement;
    const placeholder = () =>
      container.querySelector('[data-slot="media-loading"]');
    expect(image.dataset.loading).toBe("true");
    expect(placeholder()?.className).toContain("animate-pulse");

    await act(() => {
      image.dispatchEvent(new Event("load"));
    });
    expect(image.dataset.loading).toBeUndefined();
    expect(placeholder()).toBeNull();
    await act(() => root.unmount());
  });
});
