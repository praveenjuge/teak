import { expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const mutation = () =>
  Object.assign(mock(), { withOptimisticUpdate: () => mock() });
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: mutation,
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => undefined,
}));

const { act } = await import("react");
const { hydrateRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { MasonryGrid } = await import("../MasonryGrid");

const cards = ["card_a", "card_b", "card_c"].map(
  (id) =>
    ({
      _creationTime: 1,
      _id: id,
      content: `Note ${id}`,
      createdAt: 1,
      type: "text",
      updatedAt: 1,
      userId: "user_123",
    }) as never
);

// The server paints a CSS grid while the masonry measures an invisible copy
// of the same cards. Only the painted grid may reach assistive technology,
// tests and the keyboard; otherwise every card is there twice.
const grid = (
  <MasonryGrid
    filteredCards={cards}
    onCardClick={mock()}
    onDeleteCard={mock(async () => true)}
  />
);

const masonryOf = (container: HTMLElement) => {
  const masonry = container.querySelector(".ant-masonry");
  if (!masonry?.parentElement) {
    throw new Error("No masonry");
  }
  return masonry.parentElement;
};

test("the first paint's measuring copy is hidden from assistive technology and the keyboard", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToString(grid);

  const measuring = masonryOf(container);
  expect(measuring.getAttribute("style")).toContain("opacity:0");
  expect(measuring.getAttribute("aria-hidden")).toBe("true");
  expect(measuring.hasAttribute("inert")).toBe(true);
  const exposed = [...container.querySelectorAll("[data-card-id]")].filter(
    (node) => !node.closest("[aria-hidden='true']")
  );
  expect(exposed.map((node) => node.getAttribute("data-card-id"))).toEqual([
    "card_a",
    "card_b",
    "card_c",
  ]);
});

test("the masonry is exposed once it has laid the cards out", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(grid);
  const root = await act(() => hydrateRoot(container, grid));

  const masonry = masonryOf(container);
  expect(masonry.hasAttribute("aria-hidden")).toBe(false);
  expect(masonry.hasAttribute("inert")).toBe(false);
  expect(container.querySelectorAll("[data-card-id]")).toHaveLength(3);
  await act(() => root.unmount());
});
