import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const React = await import("react");
const { act } = React;

interface SaveArgs {
  content: string;
  trashedDuplicate?: string;
}
let nextOutcome: (args: SaveArgs) => unknown = () => ({
  cardId: "card_new",
  outcome: "created",
});
const createCard = Object.assign(
  mock((args: SaveArgs) => Promise.resolve(nextOutcome(args))),
  { withOptimisticUpdate: () => createCard }
);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () => createCard,
}));
// Every query answers with the signed-in account and its card status.
mock.module("../../../lib/convexQueryHooks", () => ({
  useQuery: () => ({ _id: "user_a", canCreateCard: true }),
}));
const toast = {
  error: mock(),
  info: mock(),
  loading: mock(() => "toast-id"),
  success: mock(),
};
mock.module("sonner", () => ({ toast }));
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
const { composerDraftKey } = await import("../../../lib/composerDraft");

const DRAFT_KEY = composerDraftKey("user_a");
let root: Root | undefined;

beforeEach(() => {
  window.localStorage.clear();
  nextOutcome = () => ({ cardId: "card_new", outcome: "created" });
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  createCard.mockClear();
  for (const fn of Object.values(toast)) {
    fn.mockClear();
  }
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<AddCardForm onOpenCard={() => undefined} />));
}

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown content"]'
  );

async function type(text: string) {
  const element = textarea();
  expect(element).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(element, text);
    element?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressSaveShortcut() {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === "save shortcut"
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}

const leaveIsBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

test("keeps the draft through a reload, for the signed-in account", async () => {
  await mount();
  await type("Half a thought");
  expect(window.localStorage.getItem(DRAFT_KEY)).toBe("Half a thought");

  await act(() => root?.unmount());
  await mount();
  expect(textarea()?.value).toBe("Half a thought");
  // Stored, so closing the tab doesn't need to ask.
  expect(leaveIsBlocked()).toBe(false);
});

test("forgets the draft once it's saved or emptied", async () => {
  window.localStorage.setItem(DRAFT_KEY, "Ready to save");
  await mount();
  expect(textarea()?.value).toBe("Ready to save");

  await pressSaveShortcut();
  expect(createCard).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

  await type("Second try");
  await type("");
  expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
});

test("asks before the tab closes when the browser can't keep the draft", async () => {
  const storage = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    },
  });
  try {
    await mount();
    expect(leaveIsBlocked()).toBe(false);
    await type("Only in this tab");
    expect(leaveIsBlocked()).toBe(true);
  } finally {
    if (storage) {
      Object.defineProperty(window, "localStorage", storage);
    }
  }
});

test("a link in Trash isn't saved again, and the toast offers to restore it", async () => {
  nextOutcome = (args) =>
    args.trashedDuplicate === "restore"
      ? {
          cardId: "card_trashed",
          outcome: "resaved",
          wasTrashed: true,
        }
      : { cardId: "card_trashed", outcome: "inTrash" };
  await mount();
  await type("https://example.com/trashed");
  await pressSaveShortcut();

  expect(createCard.mock.calls[0]?.[0]).toMatchObject({
    content: "https://example.com/trashed",
    trashedDuplicate: "report",
  });
  expect(toast.success).not.toHaveBeenCalled();
  const [message, options] = toast.info.mock.calls[0] as unknown as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
  expect(message).toBe("This link is in Trash");
  expect(options.action.label).toBe("Restore");
  // Nothing was saved, so the draft stays.
  expect(textarea()?.value).toBe("https://example.com/trashed");

  await act(async () => {
    options.action.onClick();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(createCard.mock.calls[1]?.[0]).toMatchObject({
    content: "https://example.com/trashed",
    trashedDuplicate: "restore",
  });
  expect(toast.success.mock.calls[0]?.[0]).toBe(
    "Restored from Trash · Moved to the top"
  );
  expect(textarea()?.value).toBe("");
});
