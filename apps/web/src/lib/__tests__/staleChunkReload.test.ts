import { describe, expect, test } from "bun:test";
import { reloadOnStaleChunk } from "../staleChunkReload";

function fakeWindow() {
  const events = new EventTarget();
  const stored = new Map<string, string>();
  let reloads = 0;
  const target = {
    addEventListener: events.addEventListener.bind(events),
    location: { reload: () => reloads++ },
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  } as unknown as Window;
  const failChunk = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { failChunk, reloads: () => reloads, target };
}

describe("a code-split file missing after a deploy", () => {
  test("reloads the page once and stops Vite throwing", () => {
    const page = fakeWindow();
    reloadOnStaleChunk(page.target, () => 1000);
    expect(page.failChunk()).toBe(true);
    expect(page.reloads()).toBe(1);
  });

  test("doesn't reload again in a loop when the files are really gone", () => {
    const page = fakeWindow();
    let time = 1000;
    reloadOnStaleChunk(page.target, () => time);
    page.failChunk();
    time += 2000;
    expect(page.failChunk()).toBe(false);
    expect(page.reloads()).toBe(1);
    time += 20_000;
    page.failChunk();
    expect(page.reloads()).toBe(2);
  });
});
