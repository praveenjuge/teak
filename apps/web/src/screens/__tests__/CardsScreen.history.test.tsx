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
const { parseSearchUrlState, serializeSearchUrlState } = await import(
  "../../lib/searchUrlState"
);

const FIRST_SEED = 1;
const firstEntry = `/?sort=shuffle&seed=${FIRST_SEED}`;
const routerUrlState = parseSearchUrlState(
  new URLSearchParams(`sort=shuffle&seed=${FIRST_SEED}`)
);

function SignedInLibrary() {
  const { isAuthenticated } = useConvexAuth();
  if (!isAuthenticated) {
    return null;
  }
  return (
    <CardsScreen
      onCloseCard={() => undefined}
      onOpenCard={() => undefined}
      onSearchUrlStateChange={(state) => {
        const query = serializeSearchUrlState(state, window.location.search);
        window.history.pushState(null, "", `/?${query}`);
      }}
      searchUrlState={routerUrlState}
      selectedCardId={null}
      upgradeUrl="/settings"
      view="all"
    />
  );
}

const card = (id: string) => ({
  _creationTime: 1,
  _id: id,
  content: id,
  createdAt: 1,
  isFavorited: false,
  tags: [],
  type: "text",
  updatedAt: 1,
  userId: "user_1",
});

const shownOrder = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-card-id]")].map((element) =>
    element.getAttribute("data-card-id")
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

test("Back right after a reshuffle shows the earlier order again", async () => {
  window.history.replaceState(null, "", firstEntry);
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
  const page = (ids: string[]) => ({
    continueCursor: "end",
    isDone: true,
    page: ids.map(card),
  });
  const replyAll = () => {
    transport.reply(
      "cards:searchCardsPaginated",
      page(["card_a", "card_b"]),
      (args) => args.shuffleSeed === FIRST_SEED
    );
    transport.reply(
      "cards:searchCardsPaginated",
      page(["card_b", "card_a"]),
      (args) => args.shuffleSeed !== FIRST_SEED
    );
  };

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
  await act(replyAll);
  expect(shownOrder(container)).toEqual(["card_a", "card_b"]);

  const reshuffle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Reshuffle"]'
  );
  if (!reshuffle) {
    throw new Error("No Reshuffle button");
  }
  await act(() => reshuffle.click());
  await act(replyAll);
  expect(shownOrder(container)).toEqual(["card_b", "card_a"]);
  expect(window.location.search).not.toBe(`?sort=shuffle&seed=${FIRST_SEED}`);

  await act(() => {
    window.history.replaceState(null, "", firstEntry);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(replyAll);
  expect(shownOrder(container)).toEqual(["card_a", "card_b"]);
});
