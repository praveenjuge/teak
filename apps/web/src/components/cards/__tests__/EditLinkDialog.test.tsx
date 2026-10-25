import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const writes: unknown[] = [];
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () => (args: unknown) => {
    writes.push(args);
    return Promise.resolve(null);
  },
}));
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: () => undefined,
    success: (message: string) => {
      toasts.push(message);
    },
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { EditLinkDialog, editedLinkUrl } = await import("../EditLinkDialog");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  writes.length = 0;
  toasts.length = 0;
});

const onOpenChange = mock();

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <EditLinkDialog
        card={{ id: "card_1", url: "https://old.example.com/a" }}
        onOpenChange={onOpenChange}
        open
      />
    )
  );
}

const input = () => document.querySelector("input") as HTMLInputElement;

async function submit(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  await act(() => {
    setValue?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input().form?.requestSubmit();
    await Promise.resolve();
  });
}

describe("editedLinkUrl", () => {
  test("keeps http and https links, trimmed, and refuses the rest", () => {
    expect(editedLinkUrl("  https://example.com/x  ")).toBe(
      "https://example.com/x"
    );
    expect(editedLinkUrl("http://example.com")).toBe("http://example.com");
    for (const value of ["", "example.com", "javascript:alert(1)", "ftp://a"]) {
      expect(editedLinkUrl(value)).toBeNull();
    }
  });
});

describe("EditLinkDialog", () => {
  test("opens with the link's address", async () => {
    await render();
    expect(input().value).toBe("https://old.example.com/a");
    expect(document.body.textContent).toContain(
      "Saving a new address refreshes the card’s preview."
    );
  });

  test("refuses an address that isn't an http or https link", async () => {
    await render();
    await submit("not a link");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Use an http or https link."
    );
    expect(writes).toEqual([]);
  });

  test("saves a new address through the url field", async () => {
    await render();
    await submit(" https://new.example.com/b ");
    expect(writes).toEqual([
      { cardId: "card_1", field: "url", value: "https://new.example.com/b" },
    ]);
    expect(toasts).toEqual([
      "Link saved. Its preview will refresh in a moment.",
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
