import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import("@/lib/convexQueryCache");
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

test("a folder's search box never offers to search everything, even while the folder loads", async () => {
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

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
        <ConvexQueryCacheProvider>
          <CardsScreen
            folderId="folder-1"
            onCloseCard={() => undefined}
            onOpenCard={() => undefined}
            selectedCardId={null}
            upgradeUrl="/settings"
            view="all"
          />
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    )
  );
  const search = () =>
    container.querySelector<HTMLInputElement>("input[data-library-search]");

  expect(search()?.placeholder).toBe("Search this folder");
  expect(search()?.getAttribute("aria-label")).toBe("Search this folder");

  await act(() =>
    transport.reply("folders:getFolder", {
      _id: "folder-1",
      activeCardCount: 2,
      createdAt: 0,
      kind: "manual",
      name: "Reading",
      updatedAt: 0,
    })
  );

  expect(search()?.placeholder).toBe("Search Reading");
});
