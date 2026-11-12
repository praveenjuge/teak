import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardSteps } = await import("../useCardSteps");

const CARDS = ["a", "b", "c", "d", "e", "f"];
let root: Root | undefined;
let current = "a";
let ready = true;
let open = true;
let saving: Promise<boolean> | null = null;
let step: ReturnType<typeof useCardSteps> = () => undefined;
const visited: string[] = [];

// Steps from the card the last step went to, as the library does, while
// the card on screen (`cardId`) changes only when `land` renders it.
function Harness({ cardId }: { cardId: string }) {
  step = useCardSteps({
    cardId,
    onStep: (direction) => {
      const target = CARDS[CARDS.indexOf(current) + direction];
      if (target) {
        visited.push(target);
        current = target;
      }
    },
    open,
    readyToLeave: () => saving ?? Promise.resolve(ready),
  });
  return null;
}

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
});

test("three quick presses move three cards before the first one shows", async () => {
  await act(async () => {
    step(1);
    step(1);
    step(1);
    await Promise.resolve();
  });
  expect(visited).toEqual(["b", "c", "d"]);
});

test("a press the other way takes back one press still waiting", async () => {
  await act(async () => {
    step(1);
    await Promise.resolve();
  });
  await act(async () => {
    step(1);
    step(1);
    step(-1);
    await Promise.resolve();
  });
  await land();
  await land();
  expect(visited).toEqual(["b", "c"]);
});

test("right then left in one go stays on the card", async () => {
  current = "c";
  await land();
  await act(async () => {
    step(1);
    step(-1);
    await Promise.resolve();
  });
  await land();
  expect(visited).toEqual([]);
  expect(current).toBe("c");
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

test("a held key moves on once the card it stepped to shows", async () => {
  await act(async () => step(1));
  await act(async () => step(1, { repeat: true }));
  expect(visited).toEqual(["b"]);
  await land();
  await act(async () => step(1, { repeat: true }));
  expect(visited).toEqual(["b", "c"]);
});

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

test("right then left while the card is still saving stays on the card", async () => {
  current = "c";
  await land();
  const saved = slowSave();
  await act(async () => {
    step(1);
    step(-1);
    await Promise.resolve();
  });
  await saved();
  await land();
  expect(visited).toEqual([]);
  expect(current).toBe("c");
});

test("left then right while the card is still saving stays on the card", async () => {
  current = "c";
  await land();
  const saved = slowSave();
  await act(async () => {
    step(-1);
    step(1);
    await Promise.resolve();
  });
  await saved();
  await land();
  expect(visited).toEqual([]);
  expect(current).toBe("c");
});

test("every press while the card is still saving counts, in order", async () => {
  current = "b";
  await land();
  const saved = slowSave();
  await act(async () => {
    step(1);
    step(1);
    step(1);
    step(-1);
    step(1);
    await Promise.resolve();
  });
  await saved();
  await land();
  await land();
  await land();
  // Four right, one left: three cards on from b, never back past it.
  expect(visited).toEqual(["c", "d", "e"]);
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
