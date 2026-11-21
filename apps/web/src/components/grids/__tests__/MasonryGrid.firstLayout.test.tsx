import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The masonry measures its items in an animation frame. Holding the frames
// keeps the grid in the state before its first layout.
const frames: FrameRequestCallback[] = [];
const holdFrame = (callback: FrameRequestCallback) => frames.push(callback);
Object.assign(globalThis, { requestAnimationFrame: holdFrame });
Object.assign(window, { requestAnimationFrame: holdFrame });

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: () =>
    Object.assign(mock(), { withOptimisticUpdate: () => mock() }),
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => undefined,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MasonryGrid } = await import("../MasonryGrid");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = (id: string, content: string) =>
  ({
    _creationTime: 1,
    _id: id,
    content,
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "user_123",
  }) as any;

test("a grid made in the browser keeps its cards hidden until the masonry has placed them", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <MasonryGrid
        filteredCards={[card("card_a", "First"), card("card_b", "Second")]}
        onBulkAction={mock(async () => ({ failedIds: [] }))}
        onCardAction={mock()}
        onCardClick={mock()}
        onDeleteForever={mock(async () => ({ failedIds: [] }))}
        resetKey=""
      />
    )
  );
  const grid = container.querySelector<HTMLElement>('[data-slot="card-grid"]');
  const masonry = () =>
    container
      .querySelector<HTMLElement>('[data-card-id="card_a"]')
      ?.parentElement?.closest<HTMLElement>('[data-slot="card-grid"] > *');
  // No server-rendered stand-in: the cards are simply not shown yet.
  expect(grid?.querySelector('[data-slot="first-paint-grid"]')).toBeNull();
  expect(masonry()?.style.visibility).toBe("hidden");
  expect(masonry()?.style.opacity).toBe("0");

  for (let turn = 0; turn < 20 && frames.length > 0; turn++) {
    await act(() => {
      for (const frame of frames.splice(0)) {
        frame(performance.now());
      }
    });
  }
  expect(masonry()?.style.visibility).toBe("");
  expect(masonry()?.style.opacity).toBe("");
});
