/// <reference types="bun" />
import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { TeakSaveResponse } from "../../types/messages";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// The other test files in this run expect Bun's own fetch and Request.
afterAll(() => GlobalRegistrator.unregister());

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useAutoSaveUrl } = await import("../../hooks/useAutoSaveUrl");

const originalChrome = globalThis.chrome;
let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  globalThis.chrome = originalChrome;
});

const autoSave = async (response: TeakSaveResponse) => {
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (_message: unknown, reply: (r: TeakSaveResponse) => void) =>
        reply(response),
    },
    storage: { local: { get: async () => ({}) } },
    tabs: { query: async () => [{ url: "https://example.com/article" }] },
  } as unknown as typeof chrome;
  const seen: ReturnType<typeof useAutoSaveUrl>[] = [];
  function Probe() {
    seen.push(useAutoSaveUrl(true));
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Probe />));
  // The hook waits 300ms before reading the tab.
  await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
  return seen.at(-1);
};

test("keeps the saved card's id", async () => {
  expect(await autoSave({ status: "saved", cardId: "card_new" })).toMatchObject(
    { cardId: "card_new", state: "success" }
  );
});

test("keeps the id of the card already saved for the page", async () => {
  expect(
    await autoSave({ status: "duplicate", cardId: "card_old" })
  ).toMatchObject({ cardId: "card_old", state: "duplicate" });
});
