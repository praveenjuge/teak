import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName } from "convex/server";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const React = await import("react");
const { act } = React;

type Optimistic = (
  store: OptimisticLocalStore,
  args: { content?: string }
) => void;
let optimisticUpdate: Optimistic | undefined;
let saveResult: unknown;
const createCard = Object.assign(
  mock(async (_args: { content: string }) => saveResult),
  {
    withOptimisticUpdate: (update: Optimistic) => {
      optimisticUpdate = update;
      return createCard;
    },
  }
);
let pasteResult: () => Promise<unknown>;
const startLinkPaste = mock((_args: { urls: string[] }) => pasteResult());

let canCreateCard = true;
let pasteProgress: unknown;

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: (reference: unknown) =>
    getFunctionName(reference as never) === "card/pasteLinks:startLinkPaste"
      ? startLinkPaste
      : createCard,
}));
mock.module("../../../lib/convexQueryHooks", () => ({
  useQuery: (reference: unknown) =>
    getFunctionName(reference as never) === "card/pasteLinks:getLinkPaste"
      ? pasteProgress
      : { canCreateCard },
}));
const toast = {
  dismiss: mock(),
  error: mock(),
  loading: mock(() => "toast-id"),
  success: mock(),
};
mock.module("sonner", () => ({ toast }));
const realTextEditor = await import("@/components/text-editor");
mock.module("@/components/text-editor", () => ({
  ...realTextEditor,
  MarkdownTextEditor: ({
    ariaLabel,
    disabled,
    onChange,
    onSaveShortcut,
    value,
  }: {
    ariaLabel?: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    onSaveShortcut?: () => void;
    value: string;
  }) =>
    React.createElement(
      "div",
      null,
      React.createElement("textarea", {
        "aria-label": ariaLabel,
        disabled,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          onChange(event.target.value),
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
const { finishLinkPasteJob } = await import("../linkPasteJobs");

const KNOWN = "https://www.example.com/post/";
const links = (count: number) =>
  Array.from({ length: count }, (_, index) => `https://example.com/${index}`);

let root: Root | undefined;

beforeEach(() => {
  canCreateCard = true;
  pasteProgress = undefined;
  optimisticUpdate = undefined;
  saveResult = { cardId: "card-1", outcome: "created" };
  pasteResult = () => Promise.resolve({ jobId: "job-1" });
  for (const fn of Object.values(toast)) {
    fn.mockClear();
  }
  createCard.mockClear();
  startLinkPaste.mockClear();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  // Paste jobs outlive a composer, so one test's job must not reach the next.
  finishLinkPasteJob("job-1" as Id<"linkPasteJobs">);
  document.body.innerHTML = "";
});

async function render(props: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<AddCardForm {...props} />));
}

// A paste's toast is let go a tick after its last composer unmounts.
const nextTick = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function rerender(props: Record<string, unknown> = {}) {
  await act(() => root?.render(<AddCardForm {...props} />));
}

const limitToasts = () =>
  toast.error.mock.calls.filter(
    ([message]) => (message as string) === "Free card limit reached"
  );

const textarea = () =>
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Markdown content"]'
  );

async function type(text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(textarea(), text);
    textarea()?.dispatchEvent(new Event("input", { bubbles: true }));
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

const submitButton = () =>
  document.querySelector<HTMLButtonElement>('button[type="submit"]');

const card = (overrides: Partial<Doc<"cards">>): Doc<"cards"> =>
  ({
    _creationTime: 1,
    _id: "card-1" as Id<"cards">,
    content: "note",
    createdAt: 1,
    type: "text",
    updatedAt: 1,
    userId: "user-1",
    ...overrides,
  }) as Doc<"cards">;

describe("saving a link that's already in Teak", () => {
  test("says it moved to the top, opens the card, and leaves no second tile", async () => {
    saveResult = { cardId: "card-1", outcome: "resaved" };
    const onOpenCard = mock((_cardId: string) => undefined);
    await render({ onOpenCard });
    await type(KNOWN);
    await pressSaveShortcut();

    expect(createCard).toHaveBeenCalledWith({ content: KNOWN, source: "web" });
    const [message, options] = toast.success.mock.calls.at(-1) as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Already in Teak · Moved to the top");
    expect(options.action.label).toBe("Open");
    options.action.onClick();
    expect(onOpenCard).toHaveBeenCalledWith("card-1");

    // While it saves, the grid shows the saved card at the top, once.
    const saved = card({
      _id: "card-1" as Id<"cards">,
      content: "http://example.com/post",
      type: "link",
      url: "http://example.com/post",
    });
    const other = card({ _id: "card-2" as Id<"cards"> });
    let page: Doc<"cards">[] = [other, saved];
    const store = {
      getAllQueries: (query: unknown) =>
        getFunctionName(query as never) === "cards:searchCardsPaginated"
          ? [
              {
                args: { paginationOpts: { cursor: null, numItems: 20 } },
                value: { continueCursor: "", isDone: true, page },
              },
            ]
          : [],
      setQuery: (_query: unknown, _args: unknown, value: { page: never }) => {
        page = value.page;
      },
    } as unknown as OptimisticLocalStore;
    optimisticUpdate?.(store, { content: KNOWN });
    expect(page.map((entry) => entry._id)).toEqual(["card-1", "card-2"]);
  });

  test("says it came back from Archive", async () => {
    saveResult = { cardId: "card-1", outcome: "resaved", wasArchived: true };
    await render();
    await type(KNOWN);
    await pressSaveShortcut();

    expect(toast.success.mock.calls.at(-1)?.[0]).toBe(
      "Already in Teak · Moved back from Archive"
    );
  });

  test("still says Link saved for a new link", async () => {
    await render();
    await type("https://example.com/new");
    await pressSaveShortcut();

    expect(toast.success.mock.calls.at(-1)?.[0]).toBe("Link saved");
  });
});

describe("the Save button", () => {
  test.each([
    ["a note", "Plain text", "Save"],
    ["one link", "https://example.com/a", "Save"],
    ["two links", links(2).join("\n"), "Save 2 links"],
    ["101 links", links(101).join("\n"), "Save first 100 links"],
  ])("reads its label for %s", async (_name, text, label) => {
    await render();
    await type(text);
    expect(submitButton()?.textContent).toStartWith(label);
  });

  test("shows no button for an empty draft", async () => {
    await render();
    expect(submitButton()).toBeNull();
  });
});

describe("pasting a list of links", () => {
  test("starts one job with every link, clears the draft and shows progress", async () => {
    await render();
    await type(links(12).join("\n"));
    await pressSaveShortcut();
    await pressSaveShortcut();

    expect(startLinkPaste).toHaveBeenCalledTimes(1);
    expect(startLinkPaste).toHaveBeenCalledWith({ urls: links(12) });
    expect(createCard).not.toHaveBeenCalled();
    expect(textarea()?.value).toBe("");
    expect(toast.loading).toHaveBeenCalledWith("Saving links · 0 of 12");

    pasteProgress = {
      status: "running",
      total: 12,
      processed: 8,
      created: 8,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    // Any render reads the job's latest progress.
    await type("a new draft");
    expect(toast.loading).toHaveBeenLastCalledWith("Saving links · 8 of 12", {
      id: "toast-id",
    });

    pasteProgress = {
      status: "done",
      total: 12,
      processed: 12,
      created: 9,
      resaved: 3,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await type("a newer draft");
    expect(toast.success).toHaveBeenLastCalledWith(
      "Saved 9 links · 3 already in Teak, moved to the top",
      { id: "toast-id" }
    );
  });

  test("ends at the card limit with the Upgrade action", async () => {
    const onUpgrade = mock(() => undefined);
    pasteProgress = {
      status: "stopped_at_limit",
      total: 12,
      processed: 7,
      created: 4,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await render({ onUpgrade });
    await type(links(12).join("\n"));
    await pressSaveShortcut();

    const [message, options] = toast.error.mock.calls.at(-1) as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Saved 4 of 12 links · You've reached 200 cards");
    expect(options.action.label).toBe("Upgrade");
    options.action.onClick();
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  test("keeps the draft when the last paste is still saving", async () => {
    pasteResult = () =>
      Promise.reject(
        Object.assign(new Error("busy"), { data: { code: "PASTE_ACTIVE" } })
      );
    await render();
    const draft = links(3).join("\n");
    await type(draft);
    await pressSaveShortcut();

    expect(textarea()?.value).toBe(draft);
    expect(toast.error).toHaveBeenLastCalledWith(
      "Still saving your last links. Try again in a moment.",
      { id: "toast-id" }
    );
  });

  test("stays savable at the card limit, where a note offers the upgrade", async () => {
    canCreateCard = false;
    await render();
    // The editor stays open at the limit, so a list can be pasted into it.
    expect(textarea()?.disabled).toBeFalsy();
    await type("A note");
    expect(submitButton()?.disabled).toBe(false);
    const toastsBefore = limitToasts().length;
    await pressSaveShortcut();
    expect(createCard).not.toHaveBeenCalled();
    expect(limitToasts()).toHaveLength(toastsBefore + 1);
    expect(textarea()?.value).toBe("A note");

    await type(links(2).join("\n"));
    await pressSaveShortcut();
    expect(startLinkPaste).toHaveBeenCalledTimes(1);
    expect(createCard).not.toHaveBeenCalled();
  });

  test("keeps tracking a paste after the composer is replaced", async () => {
    await render();
    await type(links(3).join("\n"));
    await pressSaveShortcut();
    expect(toast.loading).toHaveBeenCalledWith("Saving links · 0 of 3");

    // The first cards in an empty library swap the empty state's composer
    // for the grid's.
    await act(() => root?.unmount());
    await nextTick();
    // With no composer on the page, no spinner is left behind.
    expect(toast.dismiss).toHaveBeenCalledWith("toast-id");
    pasteProgress = {
      status: "done",
      total: 3,
      processed: 3,
      created: 3,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await render();

    expect(toast.success).toHaveBeenLastCalledWith("Saved 3 links", {
      id: "toast-id",
    });
  });

  test("keeps the paste's toast when React mounts the composer twice", async () => {
    // Development's double effect unmounts and remounts the tracker. Sonner
    // drops the next message shown under a toast id just dismissed, so the
    // toast must stay live across the remount.
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(() =>
      root?.render(
        <React.StrictMode>
          <AddCardForm />
        </React.StrictMode>
      )
    );
    await type(links(3).join("\n"));
    await pressSaveShortcut();
    await nextTick();
    expect(toast.dismiss).not.toHaveBeenCalled();

    pasteProgress = {
      status: "done",
      total: 3,
      processed: 3,
      created: 3,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await act(() =>
      root?.render(
        <React.StrictMode>
          <AddCardForm />
        </React.StrictMode>
      )
    );
    await nextTick();
    expect(toast.success).toHaveBeenLastCalledWith("Saved 3 links", {
      id: "toast-id",
    });
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  test("leaves the limit to the paste's own toast", async () => {
    await render();
    await type(links(12).join("\n"));
    await pressSaveShortcut();

    // The paste reaches the limit before its job reports back.
    canCreateCard = false;
    await rerender();
    expect(limitToasts()).toHaveLength(0);

    pasteProgress = {
      status: "stopped_at_limit",
      total: 12,
      processed: 7,
      created: 4,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await rerender();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      "Saved 4 of 12 links · You've reached 200 cards"
    );

    await rerender();
    expect(limitToasts()).toHaveLength(0);
  });

  test("offers the upgrade once a paste that saved every link lands on the limit", async () => {
    await render();
    await type(links(10).join("\n"));
    await pressSaveShortcut();

    canCreateCard = false;
    await rerender();
    expect(limitToasts()).toHaveLength(0);

    pasteProgress = {
      status: "done",
      total: 10,
      processed: 10,
      created: 10,
      resaved: 0,
      failed: 0,
      omittedOverLimit: 0,
      omittedRepeats: 0,
    };
    await rerender();
    expect(toast.success).toHaveBeenLastCalledWith("Saved 10 links", {
      id: "toast-id",
    });
    expect(limitToasts()).toHaveLength(1);

    await rerender();
    expect(limitToasts()).toHaveLength(1);
  });

  test("offers the upgrade when the limit arrives without a paste", async () => {
    await render();
    canCreateCard = false;
    await rerender();
    expect(limitToasts()).toHaveLength(1);
  });
});
