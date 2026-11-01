import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act, createElement } = await import("react");
const { mock } = await import("bun:test");
const realGrids = { ...(await import("@/components/grids")) };
const RealMasonryGrid = realGrids.MasonryGrid;
type GridProps = Parameters<typeof RealMasonryGrid>[0];
const gridRenders: GridProps[] = [];
mock.module("@/components/grids", () => ({
  ...realGrids,
  MasonryGrid: (props: GridProps) => {
    gridRenders.push(props);
    return createElement(RealMasonryGrid, props);
  },
}));

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
  gridRenders.length = 0;
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

test("closing the open card hands the grid the same props, so it skips a re-render", async () => {
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
  // Each render passes new callbacks, as the page does when the URL changes.
  const render = (selectedCardId: string | null) =>
    act(() =>
      root?.render(
        <ConvexProviderWithAuth client={transport.client} useAuth={useAuth}>
          <ConvexQueryCacheProvider>
            <CardsScreen
              onCloseCard={() => undefined}
              onOpenCard={() => undefined}
              onSwitchCard={() => undefined}
              selectedCardId={selectedCardId}
              upgradeUrl="/settings"
              view="all"
            />
          </ConvexQueryCacheProvider>
        </ConvexProviderWithAuth>
      )
    );

  await render("card_1");
  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      continueCursor: "end",
      isDone: true,
      page: [QUOTE],
    })
  );
  expect(container.querySelector('[data-card-id="card_1"]')).not.toBeNull();

  const beforeClose = gridRenders.at(-1);
  const rendersBeforeClose = gridRenders.length;
  await render(null);
  expect(gridRenders.length).toBeGreaterThan(rendersBeforeClose);

  const afterClose = gridRenders.at(-1) ?? {};
  const changed = Object.keys({ ...beforeClose, ...afterClose }).filter(
    (key) =>
      !Object.is(
        beforeClose?.[key as keyof GridProps],
        afterClose[key as keyof GridProps]
      )
  );
  expect(changed).toEqual([]);
});
