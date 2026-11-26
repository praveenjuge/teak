import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Summary {
  isComplete: boolean;
  items: { count: number; label?: string; name: string }[];
}
let summary: Summary | null | undefined;
const requestSummary = mock(async () => null);

mock.module("convex/react", () => ({ useMutation: () => requestSummary }));
mock.module("convex-helpers/react/cache/hooks", () => ({
  usePaginatedQuery: () => ({
    results: [],
    status: "LoadingFirstPage",
    isLoading: true,
    loadMore: () => undefined,
  }),
  useQuery: (_query: unknown, args: unknown) =>
    args && typeof args === "object" && Object.keys(args).length === 0
      ? summary
      : undefined,
}));
mock.module("../../hooks/useTagOperations", () => ({
  useTagOperations: () => ({ latest: null, operation: null, start: mock() }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TestRouter, testRouter } = await import("@/__tests__/helpers/router");
const { TagsScreen } = await import("../TagsScreen");

let root: Root | undefined;

const render = async (
  props: Partial<Parameters<typeof TagsScreen>[0]> = {}
) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <TestRouter router={testRouter("/tags")}>
        <TagsScreen {...props} />
      </TestRouter>
    )
  );
};

const rows = () =>
  [
    ...document.querySelectorAll<HTMLAnchorElement>('ul[aria-label="Tags"] a'),
  ].map((anchor) => [
    anchor.getAttribute("aria-label"),
    anchor.getAttribute("href"),
  ]);

const typeInto = async (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  summary = undefined;
  requestSummary.mockClear();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("lists tags most-used first, each opening the library narrowed to it", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design systems", count: 12 },
      { name: "web", count: 3 },
      { name: "art", count: 1 },
    ],
  };
  await render();

  expect(document.body.textContent).toContain("3 tags");
  expect(rows()).toEqual([
    ["design systems 12 cards", "/?tag=design+systems"],
    ["web 3 cards", "/?tag=web"],
    ["art 1 card", "/?tag=art"],
  ]);
});

test("a tag reads as it was typed, while its link narrows by the tag itself", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design systems", count: 2, label: "Design Systems" },
      { name: "web", count: 1 },
    ],
  };
  await render();

  expect(rows()).toEqual([
    ["Design Systems 2 cards", "/?tag=design+systems"],
    ["web 1 card", "/?tag=web"],
  ]);
  expect(
    document.querySelector('button[aria-label="More for Design Systems"]')
  ).not.toBeNull();
});

test("finds a tag ignoring case and says when nothing matches", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design", count: 4 },
      { name: "webdesign", count: 2 },
      { name: "art", count: 1 },
    ],
  };
  await render();
  const find = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a tag"]'
  );
  if (!find) {
    throw new Error("No find box");
  }

  await typeInto(find, " DESIGN ");
  expect(rows().map(([text]) => text)).toEqual([
    "design 4 cards",
    "webdesign 2 cards",
  ]);
  expect(document.body.textContent).toContain("2 of 3 tags");

  await typeInto(find, "nothing");
  expect(rows()).toEqual([]);
  expect(document.body.textContent).toContain("No tags match “nothing”.");
});

test("clears a search that matches nothing and puts focus back in the find box", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design", count: 4 },
      { name: "art", count: 1 },
    ],
  };
  await render();
  const find = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a tag"]'
  );
  if (!find) {
    throw new Error("No find box");
  }

  await typeInto(find, "nothing");
  expect(rows()).toEqual([]);
  const clear = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Clear search"
  );
  if (!clear) {
    throw new Error("No Clear search button");
  }

  await act(() => clear.click());
  expect(find.value).toBe("");
  expect(document.activeElement).toBe(find);
  expect(rows().map(([text]) => text)).toEqual([
    "design 4 cards",
    "art 1 card",
  ]);
  expect(document.body.textContent).not.toContain("No tags match");
});

test("a library without tags explains where they come from", async () => {
  summary = { isComplete: true, items: [] };
  await render();
  expect(document.body.textContent).toContain("No tags yet");
});

test("asks for the first snapshot when there is none", async () => {
  summary = null;
  await render();
  expect(requestSummary).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-label="Loading tags"]')).not.toBeNull();
});

const errorText = () =>
  document.querySelector('[role="alert"]')?.textContent ?? null;
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });

test("says the tags couldn't load once asking for them keeps failing, and Try again asks again", async () => {
  jest.useFakeTimers();
  try {
    summary = null;
    requestSummary.mockImplementation(() => Promise.reject(new Error("down")));
    await render();
    await advance(0);
    expect(requestSummary).toHaveBeenCalledTimes(1);
    expect(errorText()).toBeNull();

    await advance(5000);
    expect(requestSummary).toHaveBeenCalledTimes(2);
    expect(errorText()).toBe("Couldn't load your tags.Try again");
    expect(document.querySelector('[aria-label="Loading tags"]')).toBeNull();

    // No more silent retries; Try again asks once more.
    await advance(60_000);
    expect(requestSummary).toHaveBeenCalledTimes(2);
    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again"
    );
    await act(async () => retry?.click());
    expect(requestSummary).toHaveBeenCalledTimes(3);
  } finally {
    requestSummary.mockImplementation(async () => null);
    jest.useRealTimers();
  }
});

test("a request that never brings the tags stops the skeleton too", async () => {
  jest.useFakeTimers();
  try {
    summary = null;
    await render();
    await advance(45_000);
    expect(requestSummary).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(requestSummary).toHaveBeenCalledTimes(2);
    expect(errorText()).toBeNull();
    await advance(45_000);
    expect(errorText()).toBe("Couldn't load your tags.Try again");
  } finally {
    jest.useRealTimers();
  }
});

test("/ focuses the Find a tag box, like the library's search", async () => {
  summary = { isComplete: true, items: [{ name: "design", count: 4 }] };
  await render();
  const { focusLibrarySearch } = await import("../../lib/keyboardShortcuts");
  const find = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a tag"]'
  );
  if (!find) {
    throw new Error("No find box");
  }
  // happy-dom lays nothing out; the shortcut skips boxes with no layout box.
  find.getClientRects = () => [new DOMRect(0, 0, 100, 20)] as never;

  expect(focusLibrarySearch()).toBe(true);
  expect(document.activeElement).toBe(find);
});

test("starts from the URL's filter and reports each change to keep it", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design", count: 4 },
      { name: "art", count: 1 },
    ],
  };
  const changes: string[] = [];
  await render({
    initialQuery: "des",
    onQueryChange: (query) => changes.push(query),
  });
  const find = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a tag"]'
  );
  if (!find) {
    throw new Error("No find box");
  }
  expect(find.value).toBe("des");
  expect(rows().map(([text]) => text)).toEqual(["design 4 cards"]);

  await typeInto(find, "ar");
  expect(changes).toEqual(["ar"]);
  expect(rows().map(([text]) => text)).toEqual(["art 1 card"]);
});

test("follows the URL's filter when it changes from outside, not while typing", async () => {
  summary = {
    isComplete: true,
    items: [
      { name: "design", count: 4 },
      { name: "art", count: 1 },
    ],
  };
  const onQueryChange = () => undefined;
  const show = (initialQuery: string) =>
    act(() =>
      root?.render(
        <TestRouter router={testRouter("/tags")}>
          <TagsScreen
            initialQuery={initialQuery}
            onQueryChange={onQueryChange}
          />
        </TestRouter>
      )
    );
  await render({ initialQuery: "des", onQueryChange });
  const find = document.querySelector<HTMLInputElement>(
    'input[aria-label="Find a tag"]'
  );
  if (!find) {
    throw new Error("No find box");
  }

  // The URL catches up one keystroke behind; the box keeps what was typed.
  await typeInto(find, "a");
  await typeInto(find, "ar");
  await show("a");
  expect(find.value).toBe("ar");
  await show("ar");
  expect(find.value).toBe("ar");

  // The sidebar's Tags link drops `q`: every tag shows again.
  await show("");
  expect(find.value).toBe("");
  expect(rows().map(([text]) => text)).toEqual([
    "design 4 cards",
    "art 1 card",
  ]);

  // Back to a filtered entry brings its filter back.
  await show("des");
  expect(find.value).toBe("des");
  expect(rows().map(([text]) => text)).toEqual(["design 4 cards"]);
});
