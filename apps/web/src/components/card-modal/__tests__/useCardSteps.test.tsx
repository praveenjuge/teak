import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { STEP_LANDING_TIMEOUT_MS, useCardSteps } = await import(
  "../useCardSteps"
);

const CARDS = ["a", "b", "c", "d", "e", "f"];
let root: Root | undefined;
let current = "a";
let ready = true;
let open = true;
/** When set, leaving waits for the test to say the edits have saved. */
let saving: Promise<boolean> | null = null;
let step: ReturnType<typeof useCardSteps> = () => undefined;
const visited: string[] = [];

/** Like the grid: the arrows point at the neighbors of the card on screen. */
function Harness({ cardId }: { cardId: string }) {
  const index = CARDS.indexOf(cardId);
  const go = (target?: string) =>
    target
      ? () => {
          visited.push(target);
          current = target;
        }
      : undefined;
  step = useCardSteps({
    cardId,
    onNext: go(CARDS[index + 1]),
    onPrevious: go(CARDS[index - 1]),
    open,
    readyToLeave: () => saving ?? Promise.resolve(ready),
  });
  return null;
}

/** The page shows the card it was asked for. */
const land = () => act(() => root?.render(<Harness cardId={current} />));

beforeEach(async () => {
  current = "a";
  ready = true;
  open = true;
  saving = null;
  visited.length = 0;
  root = createRoot(document.createElement("div"));
  await land();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  jest.useRealTimers();
});

test("three quick presses move three cards, not one", async () => {
  await act(async () => {
    step(1);
    step(1);
    step(1);
    await Promise.resolve();
  });
  await land();
  await land();
  await land();
  expect(visited).toEqual(["b", "c", "d"]);
});

test("a press the other way drops the presses still waiting", async () => {
  await act(async () => {
    step(1);
    await Promise.resolve();
  });
  // The first press has shown its card; these arrive before it lands.
  await act(async () => {
    step(1);
    step(1);
    step(-1);
    await Promise.resolve();
  });
  await land();
  await land();
  expect(visited).toEqual(["b", "a"]);
});

test("a held key's repeats don't pile up while a step is on its way", async () => {
  await act(async () => {
    step(1);
    step(1, { repeat: true });
    step(1, { repeat: true });
    await Promise.resolve();
  });
  await land();
  await land();
  expect(visited).toEqual(["b"]);
});

test("presses past the last card stop there", async () => {
  current = "e";
  await land();
  await act(async () => {
    step(1);
    step(1);
    step(1);
    await Promise.resolve();
  });
  await land();
  await land();
  expect(visited).toEqual(["f"]);
});

test("unsaved edits that won't save keep the card and drop the queue", async () => {
  ready = false;
  await act(async () => {
    step(1);
    step(1);
    await Promise.resolve();
  });
  await land();
  expect(visited).toEqual([]);
  ready = true;
  await act(async () => step(1));
  await land();
  expect(visited).toEqual(["b"]);
});

test("a step that never lands stops blocking the next press", async () => {
  jest.useFakeTimers();
  // A page that ignores the step: the card on screen never changes.
  await act(() => root?.render(<Harness cardId="a" key="stuck" />));
  current = "a";
  await act(async () => step(1));
  expect(visited).toEqual(["b"]);
  await act(() => {
    jest.advanceTimersByTime(STEP_LANDING_TIMEOUT_MS);
  });
  await act(async () => step(1));
  expect(visited).toEqual(["b", "b"]);
});

/** Leaving a card with unsaved edits waits for them to save. */
function slowSave() {
  let finish: (saved: boolean) => void = () => undefined;
  saving = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  return async (saved = true) => {
    saving = null;
    await act(async () => {
      finish(saved);
      await Promise.resolve();
    });
  };
}

test("pressing back while the card is still saving goes back one, without a detour", async () => {
  current = "c";
  await land();
  const saved = slowSave();
  await act(async () => {
    step(1);
    step(1);
    step(1);
    step(-1);
    await Promise.resolve();
  });
  await saved();
  await land();
  await land();
  expect(visited).toEqual(["b"]);
});

test("closing the card while it saves doesn't step to another card", async () => {
  current = "c";
  await land();
  const saved = slowSave();
  await act(async () => {
    step(1);
    await Promise.resolve();
  });
  open = false;
  await land();
  await saved();
  expect(visited).toEqual([]);
});
