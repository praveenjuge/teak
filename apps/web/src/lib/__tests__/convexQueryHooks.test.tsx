import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

const { api } = await import("@teak/convex");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { ConvexProvider } = await import("convex/react");
const { ConvexQueryCacheProvider } = await import("../convexQueryCache");
const { QuerySeedsProvider, usePaginatedQuery, useQuery } = await import(
  "../convexQueryHooks"
);
const { createConvexTransport } = await import(
  "../../components/settings/__tests__/helpers/convexTransport"
);

type Seeds = Parameters<typeof QuerySeedsProvider>[0]["seeds"];

const folderId = "folder_1" as never;
const folder = { _id: "folder_1", name: "Reading" };
const firstPage = {
  page: [{ _id: "card_1" }, { _id: "card_2" }],
  isDone: false,
  continueCursor: "next",
};
const cardsSeed = (value: unknown) => ({
  name: "cards:searchCardsPaginated",
  // Built in another key order than the hook's args, as the server does.
  args: {
    paginationOpts: { numItems: 30, id: 0, cursor: null },
    favoritesOnly: true,
  },
  value: value as never,
});

let root: Root | undefined;
let container: HTMLDivElement;
let transport: ReturnType<typeof createConvexTransport>;
let seen: unknown[] = [];

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  seen = [];
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function Folder({ skip = false }: { skip?: boolean }) {
  const value = useQuery(api.folders.getFolder, skip ? "skip" : { folderId });
  seen.push(value);
  return <p>{value ? (value as { name: string }).name : "loading"}</p>;
}

function Cards() {
  const { results, status } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    { favoritesOnly: true },
    { initialNumItems: 30 }
  );
  return (
    <p>
      {status}:{results.map((card) => card._id).join(",")}
    </p>
  );
}

const tree = (seeds: Seeds, children: React.ReactNode) => (
  <ConvexProvider client={transport.client}>
    <QuerySeedsProvider seeds={seeds}>
      <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
    </QuerySeedsProvider>
  </ConvexProvider>
);

async function mount(seeds: Seeds, children: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(tree(seeds, children)));
}

const text = () => container.textContent ?? "";
const folderSeed = {
  name: "folders:getFolder",
  args: { folderId: "folder_1" },
  value: folder,
};

test("renders the seed on the server", () => {
  transport = createConvexTransport();
  expect(renderToString(tree([folderSeed], <Folder />))).toContain("Reading");
});

test("shows the seed while the live query loads, then the live result", async () => {
  transport = createConvexTransport();
  await mount([folderSeed], <Folder />);
  expect(text()).toBe("Reading");

  await act(() =>
    transport.reply("folders:getFolder", { ...folder, name: "Live" })
  );
  expect(text()).toBe("Live");
});

test("never falls back to a seed once the live result arrived", async () => {
  transport = createConvexTransport();
  await mount([folderSeed], <Folder />);
  await act(() =>
    transport.reply("folders:getFolder", { ...folder, name: "Live" })
  );

  // The subscription starts over (a new owner's cache, a dropped query).
  await act(() => transport.reply("folders:getFolder", undefined));
  expect(text()).toBe("loading");
});

test("ignores a seed for skipped queries and for other arguments", async () => {
  transport = createConvexTransport();
  await mount(
    [{ ...folderSeed, args: { folderId: "folder_2" } }],
    <>
      <Folder />
      <Folder skip />
    </>
  );
  expect(text()).toBe("loadingloading");
  expect(seen.every((value) => value === undefined)).toBe(true);
});

test("shows a seeded first page as still loading more, then the live pages", async () => {
  transport = createConvexTransport();
  await mount([cardsSeed(firstPage)], <Cards />);
  expect(text()).toBe("LoadingMore:card_1,card_2");

  await act(() =>
    transport.reply("cards:searchCardsPaginated", {
      ...firstPage,
      page: [{ _id: "card_3" }],
    })
  );
  expect(text()).toBe("CanLoadMore:card_3");

  await act(() => transport.reply("cards:searchCardsPaginated", undefined));
  expect(text()).toBe("LoadingFirstPage:");
});

test("shows a complete seeded first page as exhausted", async () => {
  transport = createConvexTransport();
  await mount([cardsSeed({ ...firstPage, isDone: true })], <Cards />);
  expect(text()).toBe("Exhausted:card_1,card_2");
});
