import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardQueryParamState } = await import("../useCardQueryParamState");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

async function renderHook(cardIdFromUrl: string | null) {
  const pushCardId = mock((_cardId: string) => undefined);
  const replaceCardId = mock((_cardId: string | null) => undefined);
  let hook = {} as ReturnType<typeof useCardQueryParamState>;
  function Harness() {
    hook = useCardQueryParamState({ cardIdFromUrl, pushCardId, replaceCardId });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  return { get: () => hook, pushCardId, replaceCardId };
}

test("previous and next replace the open card without adding history", async () => {
  const { get, pushCardId, replaceCardId } = await renderHook("card_a");
  await act(() => get().switchCard("card_b"));
  expect(get().selectedCardId).toBe("card_b");
  expect(replaceCardId).toHaveBeenCalledWith("card_b");
  expect(pushCardId).not.toHaveBeenCalled();
});

test("switching to the card already open does nothing", async () => {
  const { get, replaceCardId } = await renderHook("card_a");
  await act(() => get().switchCard("card_a"));
  await act(() => get().switchCard("   "));
  expect(get().selectedCardId).toBe("card_a");
  expect(replaceCardId).not.toHaveBeenCalled();
});
