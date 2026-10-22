import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { KeyboardEvent } from "react";
import type { Root } from "react-dom/client";
import type { LibraryView } from "../../lib/libraryViews";
import type { SearchUrlState } from "../../lib/searchUrlState";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardsSearchController } = await import(
  "../useCardsSearchController"
);

type Controller = ReturnType<typeof useCardsSearchController>;

let root: Root | undefined;
let controller: Controller;

interface HarnessProps {
  initialUrlState?: SearchUrlState;
  onNavigateView?: (view: LibraryView) => void;
  view?: LibraryView;
}

function Harness(props: HarnessProps) {
  controller = useCardsSearchController(props);
  return null;
}

async function render(props: HarnessProps) {
  const container = document.createElement("div");
  document.body.append(container);
  root = root ?? createRoot(container);
  await act(() => root?.render(<Harness {...props} />));
}

const press = (key: "Enter" | "Backspace", value: string) =>
  act(() =>
    controller.searchBarProps.onKeyDown({
      key,
      currentTarget: { value },
    } as unknown as KeyboardEvent<HTMLInputElement>)
  );

const typeAndPressWithIme = async (
  value: string,
  ime: { isComposing: boolean; keyCode: number }
) => {
  await act(() => controller.searchBarProps.onSearchChange(value));
  await act(() =>
    controller.searchBarProps.onKeyDown({
      key: "Enter",
      keyCode: ime.keyCode,
      nativeEvent: { isComposing: ime.isComposing },
      currentTarget: { value },
    } as unknown as KeyboardEvent<HTMLInputElement>)
  );
};

const typeAndPress = async (value: string) => {
  await act(() => controller.searchBarProps.onSearchChange(value));
  await press("Enter", value);
};

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("each routed view queries its own cards", async () => {
  await render({ view: "favorites" });
  expect(controller.queryArgs.favoritesOnly).toBe(true);
  await render({ view: "archive" });
  expect(controller.queryArgs.showArchivedOnly).toBe(true);
  expect(controller.queryArgs.favoritesOnly).toBeUndefined();
  await render({ view: "trash" });
  expect(controller.queryArgs.showTrashOnly).toBe(true);
  await render({ view: "all" });
  expect(controller.queryArgs).toEqual({});
});

test("a quick command asks to open its view instead of toggling", async () => {
  const onNavigateView = mock();
  await render({ onNavigateView, view: "all" });
  await typeAndPress("trash");
  expect(onNavigateView).toHaveBeenCalledWith("trash");
  expect(controller.searchQuery).toBe("");
  expect(controller.queryArgs.showTrashOnly).toBeUndefined();
});

test("the open view's own command goes back to Everything", async () => {
  const onNavigateView = mock();
  await render({ onNavigateView, view: "favorites" });
  await typeAndPress("fav");
  expect(onNavigateView).toHaveBeenCalledWith("all");
});

test("Backspace and Clear all never leave the view", async () => {
  await render({ view: "trash" });
  await typeAndPress("design");
  expect(controller.keywordTags).toEqual(["design"]);
  await press("Backspace", "");
  expect(controller.keywordTags).toEqual([]);
  await press("Backspace", "");
  await act(() => controller.clearAllFilters());
  expect(controller.queryArgs.showTrashOnly).toBe(true);
  expect(controller.hasNoSearchFilters).toBe(true);
  expect(controller.hasNoFilters).toBe(false);
});

test("card types round-trip through the URL state", async () => {
  await render({
    initialUrlState: { q: "", sort: "newest", types: ["image"] },
    view: "all",
  });
  expect(controller.queryArgs.types).toEqual(["image"]);
  expect(controller.urlState.types).toEqual(["image"]);
  expect(controller.hasNoSearchFilters).toBe(false);

  await act(() => controller.searchBarProps.onSearchChange("blue"));
  await act(() =>
    controller.applyUrlState({
      q: "blue",
      sort: "newest",
      types: ["image", "palette"],
    })
  );
  expect(controller.searchQuery).toBe("blue");
  expect(controller.filterTags).toEqual(["image", "palette"]);

  await act(() => controller.searchBarProps.onRemoveFilter("image"));
  expect(controller.urlState.types).toEqual(["palette"]);
});

test("a type picked mid-typing keeps the text being typed", async () => {
  await render({ view: "all" });
  await act(() => controller.searchBarProps.onSearchChange("blue"));
  await act(() =>
    controller.applyUrlState(
      { q: "", sort: "newest", types: ["image"] },
      { keepSearch: true }
    )
  );
  expect(controller.searchQuery).toBe("blue");
  expect(controller.filterTags).toEqual(["image"]);
  expect(controller.queryArgs.types).toEqual(["image"]);
});

test.each([
  ["while composing", { isComposing: true, keyCode: 229 }],
  [
    "in Safari, which ends composition first",
    { isComposing: false, keyCode: 229 },
  ],
])(
  "an Enter that confirms IME text %s leaves the text in the box",
  async (_name, ime) => {
    await render({ view: "all" });
    await typeAndPressWithIme("でざいん", ime);
    expect(controller.searchQuery).toBe("でざいん");
    expect(controller.keywordTags).toEqual([]);
  }
);
