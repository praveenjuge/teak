import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { RevisitCard, RevisitDeck } from "../../../hooks/useRevisitDeck";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const realCacheHooks = await import("convex-helpers/react/cache/hooks");
mock.module("convex-helpers/react/cache/hooks", () => ({
  ...realCacheHooks,
  useQuery: () => undefined,
}));
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { RevisitDeck: Deck } = await import("../RevisitDeck");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const card = (id: string, content: string): RevisitCard =>
  ({ _id: id, content, createdAt: 1, type: "text" }) as RevisitCard;

const deckState = (overrides: Partial<RevisitDeck>): RevisitDeck => ({
  archive: () => Promise.resolve(),
  archived: 0,
  canUndo: false,
  current: null,
  done: false,
  exhausted: false,
  finish: () => undefined,
  keep: () => undefined,
  kept: 0,
  more: () => undefined,
  move: null,
  pending: false,
  position: 1,
  retry: () => undefined,
  status: "ready",
  total: 1,
  undo: () => Promise.resolve(),
  ...overrides,
});

async function show(deck: RevisitDeck) {
  root ??= createRoot(document.createElement("div"));
  await act(() =>
    root?.render(
      <Deck
        deck={deck}
        onExit={() => undefined}
        onOpenCard={() => undefined}
        onStartOver={() => undefined}
        open
      />
    )
  );
}

test("the last card of a deck doesn't slide over the next deal", async () => {
  await show(deckState({ current: card("c1", "Last card of the deck") }));
  await show(deckState({ done: true, kept: 1, move: "keep", position: 1 }));
  expect(document.body.textContent).toContain("All caught up");
  await show(deckState({ current: card("c2", "First card of the next deal") }));
  expect(document.body.textContent).toContain("First card of the next deal");
  expect(document.body.textContent).not.toContain("Last card of the deck");
});

test("a kept card slides away as the next one takes its place", async () => {
  await show(deckState({ current: card("c1", "Kept card"), total: 2 }));
  await show(
    deckState({
      current: card("c2", "Next card"),
      move: "keep",
      position: 2,
      total: 2,
    })
  );
  const leaving = document.body.querySelector(
    '[aria-hidden="true"].animate-out'
  );
  expect(leaving?.textContent).toContain("Kept card");
});
