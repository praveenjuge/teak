import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth, useConvexAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import(
  "@teak/ui/convex-query-cache"
);
const { createConvexTransport } = await import(
  "../../components/settings/__tests__/helpers/convexTransport"
);
const { CardsScreen } = await import("../CardsScreen");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const QUOTE = {
  _creationTime: 1,
  _id: "card_1",
  content: "Less, but better.",
  createdAt: 1,
  isFavorited: false,
  tags: [],
  type: "quote",
  updatedAt: 1,
  userId: "user_1",
};

const renderLibrary = async (focusComposer: boolean) => {
  const transport = createConvexTransport();
  transport.seed("card/vaultSetup:getVaultSetup", null);
  transport.seed("folders:listFolders", []);
  transport.seed("auth:getCardCreationStatus", { canCreateCard: true });
  transport.client.setAuth = (_fetchToken, onChange) => onChange?.(true);
  transport.client.clearAuth = () => undefined;
  const fetchAccessToken = async () => "token";
  const useAuth = () => ({
    fetchAccessToken,
    isAuthenticated: true,
    isLoading: false,
  });
  const onFocusComposerHandled = mock(() => undefined);

  function SignedInLibrary() {
    const { isAuthenticated } = useConvexAuth();
    if (!isAuthenticated) {
      return null;
    }
    return (
      <CardsScreen
        focusComposer={focusComposer}
        onCloseCard={() => undefined}
        onFocusComposerHandled={onFocusComposerHandled}
        onOpenCard={() => undefined}
        selectedCardId={null}
        upgradeUrl="/settings"
        view="all"
      />
    );
  }

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
        <ConvexQueryCacheProvider>
          <SignedInLibrary />
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    )
  );
  return { container, onFocusComposerHandled, transport };
};

const composerHasFocus = (container: HTMLElement) =>
  Boolean(
    container
      .querySelector("[data-new-note-composer]")
      ?.contains(document.activeElement)
  );

test("a new-note request focuses the composer once the cards load", async () => {
  const { container, onFocusComposerHandled, transport } =
    await renderLibrary(true);
  expect(onFocusComposerHandled).toHaveBeenCalledTimes(1);

  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      continueCursor: "end",
      isDone: true,
      page: [QUOTE],
    })
  );

  expect(container.querySelector('[data-card-id="card_1"]')).not.toBeNull();
  expect(composerHasFocus(container)).toBe(true);
});

test("opening the library without the request leaves focus alone", async () => {
  const { container, onFocusComposerHandled, transport } =
    await renderLibrary(false);

  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      continueCursor: "end",
      isDone: true,
      page: [QUOTE],
    })
  );

  expect(container.querySelector('[data-card-id="card_1"]')).not.toBeNull();
  expect(composerHasFocus(container)).toBe(false);
  expect(onFocusComposerHandled).not.toHaveBeenCalled();
});
