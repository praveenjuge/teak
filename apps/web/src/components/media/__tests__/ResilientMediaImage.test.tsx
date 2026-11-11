import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = "https://files.teakvault.com/__images/v1/grid/u/c/a.jpg?sig=new";
const refresh = mock((_args: { rendition?: string }) =>
  Promise.resolve({ url: FRESH })
);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => refresh,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ResilientMediaImage } = await import("../ResilientMediaImage");

const EXPIRED =
  "https://files.teakvault.com/__images/v1/grid/u/c/a.jpg?sig=old";
let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  refresh.mockClear();
});

async function renderImage(onPermanentError = mock()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ResilientMediaImage
        alt="A fern"
        cardId="card_1"
        onPermanentError={onPermanentError}
        src={EXPIRED}
        srcSet={`${EXPIRED} 1x`}
        storageKey="u/c/a.jpg"
      />
    )
  );
  return { container, onPermanentError };
}

const failToLoad = (container: HTMLElement) =>
  act(async () => {
    container.querySelector("img")?.dispatchEvent(new Event("error"));
    await Promise.resolve();
  });

test("an expired image asks once for a fresh URL of the same rendition", async () => {
  const { container, onPermanentError } = await renderImage();
  await failToLoad(container);

  expect(refresh.mock.calls[0]?.[0]).toMatchObject({ rendition: "grid" });
  const image = container.querySelector("img");
  expect(image?.getAttribute("src")).toBe(`${FRESH}&teak_retry=1`);
  expect(image?.hasAttribute("srcset")).toBe(false);
  expect(onPermanentError).not.toHaveBeenCalled();
});

test("an image that still fails after the fresh URL gives way to the fallback", async () => {
  const { container, onPermanentError } = await renderImage();
  await failToLoad(container);
  await failToLoad(container);

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(container.querySelector("img")).toBeNull();
  expect(onPermanentError).toHaveBeenCalledWith(`${FRESH}&teak_retry=1`);
});
