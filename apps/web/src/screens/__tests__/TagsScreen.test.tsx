import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Summary {
  isComplete: boolean;
  items: { count: number; name: string }[];
}
let summary: Summary | null | undefined;
const requestSummary = mock(async () => null);

mock.module("convex/react", () => ({ useMutation: () => requestSummary }));
mock.module("convex-helpers/react/cache/hooks", () => ({
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
const { TagsScreen } = await import("../TagsScreen");

let root: Root | undefined;

const Link = ({
  children,
  href,
  ...props
}: {
  children: ReactNode;
  href: string;
  [key: string]: unknown;
}) => (
  <a href={href} {...props}>
    {children}
  </a>
);

const render = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<TagsScreen LinkComponent={Link} />));
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
    ["design systems, 12 cards", "/?tag=design+systems"],
    ["web, 3 cards", "/?tag=web"],
    ["art, 1 card", "/?tag=art"],
  ]);
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
    "design, 4 cards",
    "webdesign, 2 cards",
  ]);
  expect(document.body.textContent).toContain("2 of 3 tags");

  await typeInto(find, "nothing");
  expect(rows()).toEqual([]);
  expect(document.body.textContent).toContain("No tags match “nothing”.");
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
