import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const toastSuccess = mock();
const toastError = mock();
const realSonner = await import("sonner");
mock.module("sonner", () => ({
  ...realSonner,
  toast: { error: toastError, success: toastSuccess },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { InboundEmailPanel } = await import("../InboundEmailDialog");

type PanelProps = Parameters<typeof InboundEmailPanel>[0];

const ADDRESS = "save@in.teakvault.com";
const on = {
  address: ADDRESS,
  enabled: true,
  lastReceivedAt: null,
  sender: "ada@example.com",
  senderVerified: true,
};

let root: Root | undefined;
let writeText: ReturnType<typeof mock>;

beforeEach(() => {
  writeText = mock(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  toastSuccess.mockClear();
  toastError.mockClear();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const render = async (props: Partial<PanelProps>) => {
  const handlers = {
    onDisable: mock(() => Promise.resolve()),
    onEnable: mock(() => Promise.resolve()),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(<InboundEmailPanel {...handlers} state={on} {...props} />)
  );
  return { container, ...handlers };
};

const button = (container: HTMLElement, label: string) => {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(label)
  );
  if (!found) {
    throw new Error(`No "${label}" button`);
  }
  return found;
};

const click = (element: HTMLElement) =>
  act(async () => {
    element.click();
    await Promise.resolve();
  });

describe("InboundEmailPanel", () => {
  test("shows a skeleton while the address loads", async () => {
    const { container } = await render({ state: undefined });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).toContain("Loading Save by email");
    expect(container.textContent).not.toContain("Turn on");
  });

  test("off: Turn on calls enable once, however often it's clicked", async () => {
    let resolve: () => void = () => undefined;
    const onEnable = mock(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const { container } = await render({
      onEnable,
      state: { ...on, enabled: false },
    });
    expect(container.textContent).toContain(
      "Send or forward email to Teak, and it's saved as cards."
    );
    expect(container.textContent).not.toContain(ADDRESS);

    await click(button(container, "Turn on"));
    await click(button(container, "Turn on"));
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(button(container, "Turn on").disabled).toBe(true);
    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(button(container, "Turn on").disabled).toBe(false);
  });

  test("off with an unverified sign-in email: says to verify it, and Turn on is disabled", async () => {
    const onEnable = mock(() => Promise.resolve());
    const { container } = await render({
      onEnable,
      state: { ...on, enabled: false, senderVerified: false },
    });
    expect(container.textContent).toContain(
      "Verify your sign-in email, ada@example.com, to turn this on."
    );
    expect(button(container, "Turn on").disabled).toBe(true);
    await click(button(container, "Turn on"));
    expect(onEnable).not.toHaveBeenCalled();
  });

  test("on: shows the address and the sender, and copies the full address", async () => {
    const { container } = await render({
      state: { ...on, lastReceivedAt: Date.now() - 5 * 60_000 },
    });
    const address = container.querySelector('[data-slot="inbound-address"]');
    expect(address?.getAttribute("title")).toBe(ADDRESS);
    expect(address?.textContent).toBe(ADDRESS);
    // Only the name before the @ gives way on a narrow screen.
    expect(address?.querySelector(".shrink-0")?.textContent).toBe(
      "@in.teakvault.com"
    );
    expect(container.textContent).toContain(
      "Send from ada@example.com. Mail from other addresses isn't saved."
    );
    expect(container.textContent).toContain("attachments become their own");
    expect(container.textContent).toContain(
      "Last email received 5 minutes ago"
    );

    await click(button(container, "Copy"));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(toastSuccess).toHaveBeenCalledWith("Address copied");
  });

  test("on: Turn off calls disable", async () => {
    const { container, onDisable } = await render({});
    expect(container.textContent).not.toContain("Last email received");
    await click(button(container, "Turn off"));
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  test("says when changes are rate-limited, and otherwise to try again", async () => {
    const { container } = await render({
      onDisable: mock(() => Promise.reject({ data: { code: "RATE_LIMITED" } })),
    });
    await click(button(container, "Turn off"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Too many changes. Try again in a minute."
    );

    await act(() => root?.unmount());
    const failing = await render({
      onEnable: mock(() => Promise.reject(new Error("offline"))),
      state: { ...on, enabled: false },
    });
    await click(button(failing.container, "Turn on"));
    expect(failing.container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't update Save by email. Try again."
    );
  });
});
