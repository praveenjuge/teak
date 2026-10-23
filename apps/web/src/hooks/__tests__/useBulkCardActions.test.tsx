import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const writes: { action: string; cardIds: string[] }[] = [];
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => {
  const write = (args: { action: string; cardIds: string[] }) => {
    writes.push(args);
    return Promise.resolve({ failedIds: [], updatedIds: args.cardIds });
  };
  return {
    ...realConvexReact,
    useMutation: () =>
      Object.assign(write, { withOptimisticUpdate: () => write }),
  };
});

interface ToastCall {
  duration?: number;
  message: string;
  undo?: () => void;
}
const toasts: ToastCall[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (message: string) => {
      toasts.push({ message });
    },
    loading: () => undefined,
    success: (
      message: string,
      options?: { action?: { onClick: () => void }; duration?: number }
    ) => {
      toasts.push({
        duration: options?.duration,
        message,
        undo: options?.action?.onClick,
      });
    },
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useBulkCardActions } = await import("../useBulkCardActions");

let root: Root | undefined;
let run = {} as ReturnType<typeof useBulkCardActions>;

function Harness() {
  run = useBulkCardActions();
  return null;
}

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  toasts.length = 0;
  writes.length = 0;
});

async function render() {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
}

// Bug 31: the Undo toast left after sonner's 4 seconds, before Undo was reached.
test("a delete's Undo toast stays up for 10 seconds, and Undo restores", async () => {
  await render();
  await act(async () => {
    await run("delete", ["card_a"]);
  });
  expect(toasts).toHaveLength(1);
  expect(toasts[0]?.message).toBe("Moved 1 card to Trash");
  expect(toasts[0]?.duration).toBe(10_000);

  await act(async () => {
    toasts[0]?.undo?.();
    await Promise.resolve();
  });
  expect(writes.map(({ action }) => action)).toEqual(["delete", "restore"]);
});

test("a toast without Undo keeps the usual duration", async () => {
  await render();
  await act(async () => {
    await run("favorite", ["card_a"]);
  });
  expect(toasts[0]?.message).toBe("Added 1 card to favorites");
  expect(toasts[0]?.undo).toBeUndefined();
  expect(toasts[0]?.duration).toBeUndefined();
});
