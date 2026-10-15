import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { onDemand } = await import("../lazyWithPreload");

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

function Dialog({ open }: { open: boolean }) {
  return <p>{open ? "dialog open" : "dialog closed"}</p>;
}

describe("on-demand dialogs", () => {
  test("load nothing and render nothing until they first open", async () => {
    const load = mock(() => Promise.resolve(Dialog));
    const LazyDialog = onDemand(load);
    mount();
    await act(() => root?.render(<LazyDialog open={false} />));
    expect(container.textContent).toBe("");
    expect(load).not.toHaveBeenCalled();

    await act(() => root?.render(<LazyDialog open />));
    expect(load).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("dialog open");
  });

  test("open at once, with no loading state, once preloaded", async () => {
    const LazyDialog = onDemand(
      () => Promise.resolve(Dialog),
      () => <p>loading</p>
    );
    await LazyDialog.preload();
    mount();
    act(() => root?.render(<LazyDialog open />));
    expect(container.textContent).toBe("dialog open");
  });

  test("show their fallback when opened before their code arrives", async () => {
    let finish: (component: typeof Dialog) => void = () => undefined;
    const LazyDialog = onDemand(
      () =>
        new Promise<typeof Dialog>((resolve) => {
          finish = resolve;
        }),
      ({ open }) => <p>{open ? "loading" : ""}</p>
    );
    mount();
    await act(() => root?.render(<LazyDialog open />));
    expect(container.textContent).toBe("loading");
    await act(async () => {
      finish(Dialog);
      await LazyDialog.preload();
    });
    expect(container.textContent).toBe("dialog open");
  });

  test("stay mounted after they close", async () => {
    const LazyDialog = onDemand(() => Promise.resolve(Dialog));
    await LazyDialog.preload();
    mount();
    await act(() => root?.render(<LazyDialog open />));
    await act(() => root?.render(<LazyDialog open={false} />));
    expect(container.textContent).toBe("dialog closed");
  });

  test("keep their fallback while their code fails to load, then open once it loads", async () => {
    let attempts = 0;
    const LazyDialog = onDemand(
      () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(Dialog);
      },
      ({ open }) => <p>{open ? "loading" : ""}</p>
    );
    mount();
    await act(() => root?.render(<LazyDialog open />));
    expect(container.textContent).toBe("loading");
    expect(attempts).toBe(1);

    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(attempts).toBe(2);
    expect(container.textContent).toBe("dialog open");
  });

  test("try again after a failed load", async () => {
    let attempts = 0;
    const LazyDialog = onDemand(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(Dialog);
    });
    await expect(LazyDialog.preload()).rejects.toThrow("offline");
    await LazyDialog.preload();
    mount();
    act(() => root?.render(<LazyDialog open />));
    expect(container.textContent).toBe("dialog open");
  });
});
