import { afterAll, afterEach, expect, test } from "bun:test";
import "@/__tests__/helpers/nextRouter";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, useEffect } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth, useConvexAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import(
  "convex-helpers/react/cache/provider"
);
const { createConvexTransport } = await import(
  "../../components/settings/__tests__/helpers/convexTransport"
);
const { CardsScreen } = await import("../CardsScreen");
const { libraryUrlProps } = await import("./helpers/libraryUrl");
const { ComposerProvider, useComposerRequests } = await import(
  "../../components/forms/ComposerProvider"
);

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

// N, the palette or the New menu ask for the composer before the library
// has loaded its cards, so no composer is on screen yet.
function NewNoteRequest() {
  const { requestFocus } = useComposerRequests();
  useEffect(() => requestFocus(), [requestFocus]);
  return null;
}

const renderLibrary = async (newNote: boolean) => {
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
  function SignedInLibrary() {
    const { isAuthenticated } = useConvexAuth();
    if (!isAuthenticated) {
      return null;
    }
    return (
      <CardsScreen
        {...libraryUrlProps()}
        onCloseCard={() => undefined}
        onOpenCard={() => undefined}
        selectedCardId={null}
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
          <ComposerProvider>
            {newNote ? <NewNoteRequest /> : null}
            <SignedInLibrary />
          </ComposerProvider>
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    )
  );
  return { container, transport };
};

const composerHasFocus = (container: HTMLElement) =>
  Boolean(
    container
      .querySelector("[data-new-note-composer]")
      ?.contains(document.activeElement)
  );

test("a new-note request focuses the composer once the cards load", async () => {
  const { container, transport } = await renderLibrary(true);
  expect(composerHasFocus(container)).toBe(false);

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
  const { container, transport } = await renderLibrary(false);

  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      continueCursor: "end",
      isDone: true,
      page: [QUOTE],
    })
  );

  expect(container.querySelector('[data-card-id="card_1"]')).not.toBeNull();
  expect(composerHasFocus(container)).toBe(false);
});
