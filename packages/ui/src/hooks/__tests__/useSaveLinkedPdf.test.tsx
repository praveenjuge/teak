import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let save = mock(async (_args: unknown) => ({}) as unknown);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => (args: unknown) => save(args),
}));
const events: unknown[][] = [];
const realAnalytics = await import("@teak/convex/shared/analytics");
mock.module("@teak/convex/shared/analytics", () => ({
  ...realAnalytics,
  captureEvent: (...args: unknown[]) => {
    events.push(args);
  },
}));
const toasts: { kind: string; message: string; open?: () => void }[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (message: string) => {
      toasts.push({ kind: "error", message });
    },
    success: (
      message: string,
      options?: { action?: { label: string; onClick: () => void } }
    ) => {
      toasts.push({ kind: "success", message, open: options?.action?.onClick });
    },
  }),
}));

const { ConvexError } = await import("convex/values");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSaveLinkedPdf } = await import("../useSaveLinkedPdf");

let root: Root | undefined;
let hook = {} as ReturnType<typeof useSaveLinkedPdf>;
const opened: string[] = [];

function Harness() {
  hook = useSaveLinkedPdf((cardId) => opened.push(cardId));
  return null;
}

const render = async () => {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
};

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  toasts.length = 0;
  events.length = 0;
  opened.length = 0;
});

test("a new PDF says PDF saved, counts once, and Open shows the document", async () => {
  save = mock(async () => ({ cardId: "doc_1", created: true }));
  await render();

  await act(() => hook.save("card_a"));

  expect(save).toHaveBeenCalledWith({ cardId: "card_a" });
  expect(toasts).toMatchObject([{ kind: "success", message: "PDF saved" }]);
  expect(events).toEqual([["link_pdf_saved", { source: "panel" }]]);
  toasts[0]?.open?.();
  expect(opened).toEqual(["doc_1"]);
});

test("a PDF saved before says Already saved and isn't counted", async () => {
  save = mock(async () => ({ cardId: "doc_1", created: false }));
  await render();

  await act(() => hook.save("card_a"));

  expect(toasts).toMatchObject([{ kind: "success", message: "Already saved" }]);
  expect(events).toEqual([]);
});

test("a second click while saving makes one request", async () => {
  let finish: (value: unknown) => void = () => undefined;
  save = mock(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();

  let first: Promise<void> | undefined;
  await act(() => {
    first = hook.save("card_a");
  });
  expect(hook.savingCardId).toBe("card_a");
  await act(() => hook.save("card_a"));
  await act(async () => {
    finish({ cardId: "doc_1", created: true });
    await first;
  });

  expect(save).toHaveBeenCalledTimes(1);
  expect(hook.savingCardId).toBeNull();
});

test.each([
  ["CARD_LIMIT_REACHED", "Free card limit reached"],
  ["RATE_LIMITED", "You're saving quickly. Try again in a minute."],
  ["IN_PROGRESS", "This PDF is already being saved. Try again in a moment."],
  ["SERVICE_UNAVAILABLE", "Couldn't save the PDF. Try again."],
])("%s says %p", async (code, message) => {
  save = mock(() =>
    Promise.reject(new ConvexError({ code, message: "server words" }))
  );
  await render();

  await act(() => hook.save("card_a"));

  expect(toasts).toEqual([{ kind: "error", message }]);
  expect(hook.savingCardId).toBeNull();
});

test("a dropped connection says try again", async () => {
  save = mock(() => Promise.reject(new Error("Connection lost")));
  await render();

  await act(() => hook.save("card_a"));

  expect(toasts).toEqual([
    { kind: "error", message: "Couldn't save the PDF. Try again." },
  ]);
});
