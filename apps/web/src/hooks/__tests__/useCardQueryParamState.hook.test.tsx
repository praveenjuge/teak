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

async function renderHook(
  cardIdFromUrl: string | null,
  { canGoBack = true }: { canGoBack?: boolean } = {}
) {
  const pushCardId = mock((_cardId: string) => undefined);
  const replaceCardId = mock((_cardId: string | null) => undefined);
  const popCardEntry = mock(() => canGoBack);
  let hook = {} as ReturnType<typeof useCardQueryParamState>;
  function Harness({ urlCardId }: { urlCardId: string | null }) {
    hook = useCardQueryParamState({
      cardIdFromUrl: urlCardId,
      popCardEntry,
      pushCardId,
      replaceCardId,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness urlCardId={cardIdFromUrl} />));
  return {
    get: () => hook,
    popCardEntry,
    pushCardId,
    replaceCardId,
    urlShows: (urlCardId: string | null) =>
      act(() => root?.render(<Harness urlCardId={urlCardId} />)),
  };
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

test("closing a card opened from the list goes Back instead of adding an entry", async () => {
  const { get, popCardEntry, pushCardId, replaceCardId, urlShows } =
    await renderHook(null);
  await act(() => get().openCard("card_a"));
  await urlShows("card_a");
  await act(() => get().closeCard());
  expect(pushCardId).toHaveBeenCalledWith("card_a");
  expect(popCardEntry).toHaveBeenCalledTimes(1);
  expect(replaceCardId).not.toHaveBeenCalled();
  expect(get().selectedCardId).toBeNull();
});

test("after Previous and Next the card still closes Back to the list", async () => {
  const { get, popCardEntry, replaceCardId, urlShows } = await renderHook(null);
  await act(() => get().openCard("card_a"));
  await urlShows("card_a");
  await act(() => get().switchCard("card_b"));
  await urlShows("card_b");
  await act(() => get().closeCard());
  expect(popCardEntry).toHaveBeenCalledTimes(1);
  expect(replaceCardId).not.toHaveBeenCalledWith(null);
});

test("closing a card someone landed on through a link replaces the URL", async () => {
  const { get, popCardEntry, replaceCardId } = await renderHook("card_a");
  await act(() => get().closeCard());
  expect(popCardEntry).not.toHaveBeenCalled();
  expect(replaceCardId).toHaveBeenCalledWith(null);
});

test("closing a card opened over another card replaces, since Back would show that card", async () => {
  const { get, popCardEntry, replaceCardId, urlShows } =
    await renderHook("card_a");
  await act(() => get().openCard("card_b"));
  await urlShows("card_b");
  await act(() => get().closeCard());
  expect(popCardEntry).not.toHaveBeenCalled();
  expect(replaceCardId).toHaveBeenCalledWith(null);
});

test("after Back and Forward to a card, closing replaces the URL", async () => {
  const { get, popCardEntry, replaceCardId, urlShows } = await renderHook(null);
  await act(() => get().openCard("card_a"));
  await urlShows("card_a");
  await urlShows(null);
  await urlShows("card_a");
  await act(() => get().closeCard());
  expect(popCardEntry).not.toHaveBeenCalled();
  expect(replaceCardId).toHaveBeenCalledWith(null);
});

test("replaces the URL when Back can't return to the list", async () => {
  const { get, popCardEntry, replaceCardId, urlShows } = await renderHook(
    null,
    { canGoBack: false }
  );
  await act(() => get().openCard("card_a"));
  await urlShows("card_a");
  await act(() => get().closeCard());
  expect(popCardEntry).toHaveBeenCalledTimes(1);
  expect(replaceCardId).toHaveBeenCalledWith(null);
});

test("closing to change the search replaces the URL rather than going Back", async () => {
  const { get, popCardEntry, replaceCardId, urlShows } = await renderHook(null);
  await act(() => get().openCard("card_a"));
  await urlShows("card_a");
  await act(() => get().closeCard({ replace: true }));
  expect(popCardEntry).not.toHaveBeenCalled();
  expect(replaceCardId).toHaveBeenCalledWith(null);
});
