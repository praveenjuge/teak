import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const refreshMediaUrl = mock(() => Promise.reject(new Error("expired")));
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => refreshMediaUrl,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useLinkCardImage } = await import("../linkCardImage");
const { LinkCardBody } = await import("../LinkCardBody");

const IMAGE = "https://files.teakvault.com/cards/og.jpg";
const SCREENSHOT = "https://files.teakvault.com/cards/screenshot.jpg";
const card = {
  _id: "card_1",
  content: "",
  linkPreviewImageUrl: IMAGE,
  metadata: {
    linkPreview: {
      imageStorageKey: "cards/og.jpg",
      screenshotStorageKey: "cards/screenshot.jpg",
      status: "success",
      title: "A story",
    },
  },
  screenshotUrl: SCREENSHOT,
  type: "link",
  url: "https://example.com/story",
} as never;

function Tile() {
  const { image, onImageError } = useLinkCardImage(card);
  return (
    <LinkCardBody
      card={card}
      image={image}
      onImageError={onImageError}
      textInsets=""
      title="A story"
    />
  );
}

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("a link's image that won't load, even after a fresh URL, falls back to its screenshot", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Tile />));
  const img = () => container.querySelector("img");
  expect(img()?.getAttribute("src")).toBe(IMAGE);

  await act(async () => {
    img()?.dispatchEvent(new Event("error"));
    await Promise.resolve();
  });

  expect(refreshMediaUrl).toHaveBeenCalledTimes(1);
  expect(img()?.getAttribute("src")).toBe(SCREENSHOT);
});
