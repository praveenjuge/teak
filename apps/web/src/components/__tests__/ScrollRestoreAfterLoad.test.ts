import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}

const { restoreScrollAfterLoad } = await import("../ScrollRestoreAfterLoad");

type Listener = (event: {
  fromLocation?: Location;
  toLocation: Location;
}) => void;
interface Location {
  hash: string;
  href: string;
  state: { __TSR_key?: string };
}

const listeners = new Map<string, Set<Listener>>();
const router = {
  subscribe(type: string, listener: Listener) {
    const set = listeners.get(type) ?? new Set();
    set.add(listener);
    listeners.set(type, set);
    return () => set.delete(listener);
  },
};
const emit = (type: string, event: Parameters<Listener>[0]) => {
  for (const listener of listeners.get(type) ?? []) {
    listener(event);
  }
};

const entry = (key: string, path = "/", hash = ""): Location => ({
  hash,
  href: `${path}${hash ? `#${hash}` : ""}`,
  state: { __TSR_key: key },
});

/** Leaves `from` for `to` at the given scroll, then renders `to`. */
function navigate(from: Location, to: Location, scrolledTo: number) {
  setScroll(scrolledTo);
  emit("onBeforeLoad", { fromLocation: from, toLocation: to });
  // The router has restored or reset the window by the time it renders.
  setScroll(0);
  emit("onRendered", { fromLocation: from, toLocation: to });
}

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

let pageHeight = 0;
let stopListening: () => void = () => undefined;

beforeEach(() => {
  listeners.clear();
  pageHeight = 2000;
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => pageHeight,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
  setScroll(0);
  stopListening = restoreScrollAfterLoad(router);
});

afterEach(() => stopListening());

describe("restoreScrollAfterLoad", () => {
  const library = entry("library");
  const settings = entry("settings", "/settings");

  test("Back to the library returns to its place", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    navigate(library, settings, 600);
    expect(scrollTo).not.toHaveBeenCalled();
    navigate(settings, library, 0);
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, left: 0 });
    scrollTo.mockRestore();
  });

  test("a new entry is left where the router put it", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    navigate(library, settings, 600);
    navigate(settings, entry("tags", "/tags"), 0);
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  test("an entry with a hash is left to scroll to its target", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    const withHash = entry("docs", "/settings", "keys");
    navigate(withHash, library, 600);
    navigate(library, withHash, 0);
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  test("after it stops listening, Back does nothing", () => {
    const scrollTo = spyOn(window, "scrollTo").mockImplementation(
      () => undefined
    );
    navigate(library, settings, 600);
    stopListening();
    navigate(settings, library, 0);
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});
