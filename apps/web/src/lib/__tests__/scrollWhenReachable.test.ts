import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}

const { SCROLL_RESTORE_GIVE_UP_MS, scrollWhenReachable } = await import(
  "../scrollWhenReachable"
);

let pageHeight = 0;
let resized: (() => void) | undefined;
let observing = false;

class FakeResizeObserver {
  readonly #callback: () => void;
  constructor(callback: () => void) {
    this.#callback = callback;
  }
  observe() {
    observing = true;
    resized = this.#callback;
  }
  disconnect() {
    observing = false;
    resized = undefined;
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

/** The page grows, as a loading library does when its cards arrive. */
function growTo(height: number) {
  pageHeight = height;
  resized?.();
}

beforeEach(() => {
  pageHeight = 500;
  resized = undefined;
  observing = false;
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => pageHeight,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe("scrollWhenReachable", () => {
  test("a page that is still loading follows its content back to the place", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation((options) => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: (options as ScrollToOptions).top,
      });
    });
    scrollWhenReachable(600);
    expect(scrollTo).not.toHaveBeenCalled();
    // Only 400 fits yet: it goes as far as it can and keeps waiting.
    growTo(900);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 400, left: 0 });
    expect(observing).toBe(true);
    growTo(1500);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, left: 0 });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(observing).toBe(false);
    scrollTo.mockRestore();
  });

  test("a page already tall enough scrolls at once", () => {
    pageHeight = 2000;
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    scrollWhenReachable(600, 10);
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, left: 10 });
    expect(observing).toBe(false);
    scrollTo.mockRestore();
  });

  test("a window already in place is left alone", () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 600,
    });
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    scrollWhenReachable(600);
    growTo(2000);
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  test("a window in place vertically still gets its sideways place back", () => {
    pageHeight = 2000;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 600,
    });
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    scrollWhenReachable(600, 100);
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, left: 100 });
    scrollTo.mockRestore();
  });

  test("a shorter window makes the place reachable without the page growing", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    pageHeight = 1000;
    scrollWhenReachable(600);
    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });
    window.dispatchEvent(new Event("resize"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, left: 0 });
    expect(observing).toBe(false);
    scrollTo.mockRestore();
  });

  test("scrolling or acting first cancels the jump", () => {
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
      pageHeight = 500;
      const scrollTo = spyOn(window, "scrollTo").mockImplementation(
        () => undefined
      );
      scrollWhenReachable(600);
      window.dispatchEvent(new Event(type));
      expect(observing).toBe(false);
      growTo(2000);
      expect(scrollTo).not.toHaveBeenCalled();
      scrollTo.mockRestore();
    }
  });

  test("stopping it, or waiting too long, cancels the jump", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    const stop = scrollWhenReachable(600);
    stop();
    growTo(2000);
    expect(scrollTo).not.toHaveBeenCalled();

    pageHeight = 500;
    const setTimeoutSpy = spyOn(globalThis, "setTimeout");
    scrollWhenReachable(600);
    const [giveUp, delay] = setTimeoutSpy.mock.calls.at(-1) ?? [];
    expect(delay).toBe(SCROLL_RESTORE_GIVE_UP_MS);
    (giveUp as () => void)();
    growTo(2000);
    expect(scrollTo).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    scrollTo.mockRestore();
  });
});
