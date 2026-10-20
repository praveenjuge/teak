import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const React = await import("react");
const { act } = React;

interface PendingSave {
  content: string;
  resolve: () => void;
}
const pendingSaves: PendingSave[] = [];
const createCard = Object.assign(
  mock(
    (args: { content: string }) =>
      new Promise<void>((resolve) => {
        pendingSaves.push({ content: args.content, resolve });
      })
  ),
  { withOptimisticUpdate: () => createCard }
);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () => createCard,
}));
mock.module("../../../lib/convexQueryHooks", () => ({
  useQuery: () => ({ canCreateCard: true }),
}));
mock.module("sonner", () => ({
  toast: {
    error: mock(),
    loading: mock(() => "toast-id"),
    success: mock(),
  },
}));
const realTextEditor = await import("@/components/text-editor");
mock.module("@/components/text-editor", () => ({
  ...realTextEditor,
  MarkdownTextEditor: ({ ariaLabel, onChange, onSaveShortcut, value }: any) =>
    React.createElement(
      "div",
      null,
      React.createElement("textarea", {
        "aria-label": ariaLabel,
        onChange: (event: any) => onChange(event.target.value),
        value,
      }),
      React.createElement(
        "button",
        { onClick: () => onSaveShortcut?.(), type: "button" },
        "save shortcut"
      )
    ),
}));

const { createRoot } = await import("react-dom/client");
const { AddCardForm } = await import("../AddCardForm");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  pendingSaves.length = 0;
  createCard.mockClear();
});

async function type(text: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown content"]'
  );
  expect(textarea).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(textarea, text);
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressSaveShortcut() {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === "save shortcut"
  );
  await act(() => button?.click());
}

test("saves a second note with the shortcut while the first is still saving", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<AddCardForm />));

  await type("first note");
  await pressSaveShortcut();
  expect(pendingSaves.map((save) => save.content)).toEqual(["first note"]);

  await type("second note");
  await pressSaveShortcut();
  expect(pendingSaves.map((save) => save.content)).toEqual([
    "first note",
    "second note",
  ]);

  await act(async () => {
    for (const save of pendingSaves) {
      save.resolve();
    }
    await Promise.resolve();
  });
});

test("never submits the same note twice", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<AddCardForm />));

  await type("only once");
  await pressSaveShortcut();
  await pressSaveShortcut();
  expect(createCard).toHaveBeenCalledTimes(1);
});
