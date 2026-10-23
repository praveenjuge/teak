import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, Activity } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConvexProviderWithAuth } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import("@/lib/convexQueryCache");
const { createConvexTransport } = await import(
  "../../components/settings/__tests__/helpers/convexTransport"
);
const { CardsScreen } = await import("../CardsScreen");
const { parseSearchUrlState } = await import("../../lib/searchUrlState");
type SearchUrlState = import("../../lib/searchUrlState").SearchUrlState;

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

// Next.js keeps a page it left mounted in a hidden <Activity>. Opening a tag
// from Tags reveals the library again with the tag's URL; the library must
// show that URL, not write back the search it showed before it was hidden.
test("a library revealed on a new URL never writes its old search back", async () => {
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
  const writes: SearchUrlState[] = [];
  const library = (mode: "hidden" | "visible", query: string) => (
    <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
      <ConvexQueryCacheProvider>
        <Activity mode={mode}>
          <CardsScreen
            onCloseCard={() => undefined}
            onOpenCard={() => undefined}
            onSearchUrlStateChange={(state) => writes.push(state)}
            searchUrlState={parseSearchUrlState(new URLSearchParams(query))}
            selectedCardId={null}
            upgradeUrl="/settings"
            view="all"
          />
        </Activity>
      </ConvexQueryCacheProvider>
    </ConvexProviderWithAuth>
  );

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(library("visible", "q=poster")));
  await act(() => root?.render(library("hidden", "q=poster")));
  writes.length = 0;

  await act(() => root?.render(library("visible", "tag=design")));

  expect(writes.filter((state) => state.q === "poster")).toEqual([]);
  const input = container.querySelector<HTMLInputElement>('input[name="q"]');
  expect(input?.value).toBe("");
  expect(
    container.querySelector('[aria-label="Remove tag filter design"]')
  ).not.toBeNull();
});
