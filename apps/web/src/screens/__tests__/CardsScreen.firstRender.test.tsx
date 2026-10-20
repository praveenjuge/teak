import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth, useConvexAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import("@/lib/convexQueryCache");
const { createConvexTransport } = await import(
  "../../components/settings/__tests__/helpers/convexTransport"
);
const { CardsScreen } = await import("../CardsScreen");

function SignedInLibrary() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) {
    return null;
  }
  return (
    <CardsScreen
      onCloseCard={() => undefined}
      onOpenCard={() => undefined}
      selectedCardId={null}
      upgradeUrl="/settings"
      view="all"
    />
  );
}

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("goes from loading to the cards without showing an empty library", async () => {
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

  const composersMounted: Element[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          composersMounted.push(
            ...(node.matches("[data-new-note-composer]") ? [node] : []),
            ...node.querySelectorAll("[data-new-note-composer]")
          );
        }
      }
    }
  }).observe(container, { childList: true, subtree: true });

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

  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      continueCursor: "end",
      isDone: true,
      page: [
        {
          _creationTime: 1,
          _id: "card_1",
          content: "Less, but better.",
          createdAt: 1,
          isFavorited: false,
          tags: [],
          type: "quote",
          updatedAt: 1,
          userId: "user_1",
        },
      ],
    })
  );

  expect(container.querySelector('[data-card-id="card_1"]')).not.toBeNull();
  expect(new Set(composersMounted).size).toBe(1);
});
