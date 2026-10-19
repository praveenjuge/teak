import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";
import type { CardsSearchQueryArgs } from "../cardsSearchState";
import type {
  LoadRevisitPage,
  RevisitCard,
  RevisitPage,
} from "../useRevisitDeck";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const card = (id: string): RevisitCard =>
  ({ _id: id, content: id, createdAt: 1, type: "text" }) as RevisitCard;
const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

function fakeView(cardIds: string[], pageSize = 7) {
  const archived = new Set<string>();
  const ordered = (seed: number) =>
    (seed % 2 === 0 ? cardIds : [...cardIds].reverse()).filter(
      (id) => !archived.has(id)
    );
  const loadPage =
    (seed = 0): LoadRevisitPage =>
    (cursor) => {
      const list = ordered(seed);
      const offset = Number(cursor ?? 0);
      const isDone = list.length <= offset + pageSize;
      return Promise.resolve({
        continueCursor: isDone ? null : String(offset + pageSize),
        isDone,
        page: list.slice(offset, offset + pageSize).map(card),
      });
    };
  const query = mock(
    (
      _query: unknown,
      args: { paginationOpts: { cursor: string | null } } & CardsSearchQueryArgs
    ) => loadPage(args.shuffleSeed)(args.paginationOpts.cursor)
  );
  return { archived, loadPage, query };
}

let view = fakeView([]);
const client = {
  query: (...args: Parameters<typeof view.query>) => view.query(...args),
};
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => client,
}));
const { configureAnalytics, resetAnalytics } = await import(
  "@teak/convex/shared/analytics"
);
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  REVISIT_MAX_REQUESTS,
  REVISIT_WALK_LIMIT,
  dealRevisitCards,
  useRevisitDeck,
} = await import("../useRevisitDeck");

const dealt = async (
  loadPage: LoadRevisitPage,
  seen: Iterable<string> = []
) => {
  const { cards, exhausted } = await dealRevisitCards(loadPage, new Set(seen));
  return { exhausted, ids: cards.map((item) => item._id) };
};

describe("dealRevisitCards", () => {
  test("after archiving 5 of the first 20, the next 20 are exactly the next unseen cards", async () => {
    view = fakeView(ids("c", 45));
    const first = await dealt(view.loadPage());
    expect(first.ids).toEqual(ids("c", 20));
    for (const id of ["c0", "c3", "c7", "c11", "c19"]) {
      view.archived.add(id);
    }

    const next = await dealt(view.loadPage(), first.ids);
    expect(next.ids).toEqual(ids("c", 40).slice(20));

    const offsetPage = await view.loadPage()("20");
    expect(offsetPage.page[0]?._id).toBe("c25");
  });

  test.each([
    [1, [1], [true]],
    [19, [19], [true]],
    [20, [20], [true]],
    [21, [20, 1], [false, true]],
  ])(
    "a view of %d cards deals %j, then is used up",
    async (size, sizes, exhaustedFlags) => {
      view = fakeView(ids("c", size));
      const seen: string[] = [];
      for (const [round, expected] of sizes.entries()) {
        const deal = await dealt(view.loadPage(), seen);
        expect(deal.ids).toHaveLength(expected);
        expect(deal.exhausted).toBe(exhaustedFlags[round] ?? false);
        seen.push(...deal.ids);
      }
      expect(new Set(seen).size).toBe(size);
    }
  );

  test("follows the cursor past an empty Shuffle page", async () => {
    const pages: Record<string, RevisitPage> = {
      start: { continueCursor: "1", isDone: false, page: [] },
      "1": { continueCursor: "2", isDone: false, page: [card("a")] },
      "2": { continueCursor: null, isDone: true, page: [card("b")] },
    };
    const loadPage: LoadRevisitPage = (cursor) =>
      Promise.resolve(pages[cursor ?? "start"] as RevisitPage);
    expect(await dealt(loadPage)).toEqual({
      exhausted: true,
      ids: ["a", "b"],
    });
  });

  test("stops after its request cap when pages stay empty", async () => {
    let requests = 0;
    const empty: LoadRevisitPage = (cursor) => {
      requests += 1;
      return Promise.resolve({
        continueCursor: String(Number(cursor ?? 0) + 1),
        isDone: false,
        page: [],
      });
    };
    expect(await dealt(empty)).toEqual({ exhausted: true, ids: [] });
    expect(requests).toBe(REVISIT_MAX_REQUESTS);
  });

  test("an empty view deals nothing", async () => {
    view = fakeView([]);
    expect(await dealt(view.loadPage())).toEqual({ exhausted: true, ids: [] });
  });

  test("stops at the walk limit when every card there was seen", async () => {
    let requests = 0;
    const endless: LoadRevisitPage = (cursor) => {
      requests += 1;
      const offset = Number(cursor ?? 0);
      return Promise.resolve({
        continueCursor: String(offset + 100),
        isDone: false,
        page: ids(`p${offset}-`, 100).map(card),
      });
    };
    const seenEverything = {
      has: () => true,
    } as unknown as ReadonlySet<string>;
    const deal = await dealRevisitCards(endless, seenEverything);
    expect(deal).toEqual({ cards: [], exhausted: true });
    expect(requests).toBe(REVISIT_WALK_LIMIT / 100);
  });
});

let root: Root | undefined;
let deck = {} as ReturnType<typeof useRevisitDeck>;
const events: [string, unknown][] = [];

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  events.length = 0;
  resetAnalytics();
});

function Harness(props: {
  onArchive: (id: string) => Promise<boolean>;
  onUnarchive: (id: string) => Promise<boolean>;
  seed: number;
}) {
  deck = useRevisitDeck({
    onArchive: props.onArchive,
    onUnarchive: props.onUnarchive,
    queryArgs: { shuffleSeed: props.seed, sort: "shuffle", tag: "rv" },
  });
  return null;
}

async function mountDeck(
  cardIds: string[],
  {
    archiveFails = false,
    archiveGate,
  }: { archiveFails?: boolean; archiveGate?: Promise<void> } = {}
) {
  view = fakeView(cardIds);
  configureAnalytics({
    capture: (event, properties) => events.push([event, properties]),
  });
  const onArchive = mock(async (id: string) => {
    await archiveGate;
    if (archiveFails) {
      return false;
    }
    view.archived.add(id);
    return true;
  });
  const onUnarchive = mock((id: string) => {
    view.archived.delete(id);
    return Promise.resolve(true);
  });
  const render = async (seed: number) => {
    await act(() => {
      root?.render(
        <Harness onArchive={onArchive} onUnarchive={onUnarchive} seed={seed} />
      );
    });
    await settle();
  };
  root = createRoot(document.createElement("div"));
  await render(0);
  return { onArchive, onUnarchive, render };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const step = async (action: () => unknown) => {
  await act(async () => {
    await action();
  });
  await settle();
};

describe("useRevisitDeck", () => {
  test("steps through a fixed snapshot of the view", async () => {
    await mountDeck(ids("c", 25));
    expect(deck.status).toBe("ready");
    expect([deck.position, deck.total, deck.current?._id]).toEqual([
      1,
      20,
      "c0",
    ]);

    view.archived.add("c1");
    await step(() => deck.keep());
    expect([deck.position, deck.current?._id]).toEqual([2, "c1"]);
    await step(() => deck.archive());
    expect([deck.position, deck.current?._id]).toEqual([3, "c2"]);
    expect([deck.kept, deck.archived]).toEqual([1, 1]);
    expect(view.query).toHaveBeenCalledTimes(3);
  });

  test("a failed archive leaves the card on top", async () => {
    await mountDeck(ids("c", 3), { archiveFails: true });
    await step(() => deck.archive());
    expect([deck.position, deck.current?._id, deck.archived]).toEqual([
      1,
      "c0",
      0,
    ]);
    expect(deck.canUndo).toBe(false);
  });

  test("Z takes back archives last first, returning to each card", async () => {
    const { onUnarchive } = await mountDeck(ids("c", 5));
    await step(() => deck.archive());
    await step(() => deck.keep());
    await step(() => deck.archive());
    expect(deck.current?._id).toBe("c3");

    await step(() => deck.undo());
    expect(onUnarchive).toHaveBeenLastCalledWith("c2");
    expect([deck.current?._id, deck.archived, deck.move]).toEqual([
      "c2",
      1,
      "back",
    ]);
    await step(() => deck.undo());
    expect(onUnarchive).toHaveBeenLastCalledWith("c0");
    expect(deck.current?._id).toBe("c0");
    expect(deck.canUndo).toBe(false);
    await step(() => deck.undo());
    expect(onUnarchive).toHaveBeenCalledTimes(2);
  });

  test("Z pressed while an archive is on its way takes that archive back", async () => {
    let release: () => void = () => undefined;
    const archiveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { onUnarchive } = await mountDeck(ids("c", 3), { archiveGate });
    let archiving: Promise<void> | undefined;
    let undoing: Promise<void> | undefined;
    await act(() => {
      archiving = deck.archive();
      undoing = deck.undo();
    });
    expect(deck.pending).toBe(true);
    await act(() => deck.keep());
    expect(deck.position).toBe(1);

    release();
    await act(async () => {
      await archiving;
      await undoing;
    });
    await settle();
    expect(onUnarchive).toHaveBeenCalledWith("c0");
    expect([deck.current?._id, deck.archived, deck.canUndo]).toEqual([
      "c0",
      0,
      false,
    ]);
  });

  test("an archive that lands after the view changed leaves the new deal alone", async () => {
    let release: () => void = () => undefined;
    const archiveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { onUnarchive, render } = await mountDeck(ids("c", 4), {
      archiveGate,
    });
    let archiving: Promise<void> | undefined;
    await act(() => {
      archiving = deck.archive();
    });
    await render(1);
    expect(deck.current?._id).toBe("c3");
    release();
    await act(async () => {
      await archiving;
    });
    await settle();
    expect([deck.position, deck.archived, deck.canUndo]).toEqual([1, 0, false]);
    await step(() => deck.undo());
    expect(onUnarchive).not.toHaveBeenCalled();
  });

  test("20 more deals the next unseen cards; then Start over takes a new seed", async () => {
    const { render } = await mountDeck(ids("c", 21));
    for (let index = 0; index < 20; index += 1) {
      await step(() => (index < 5 ? deck.archive() : deck.keep()));
    }
    expect([deck.done, deck.exhausted]).toEqual([true, false]);

    await step(() => deck.more());
    expect([deck.total, deck.current?._id, deck.exhausted]).toEqual([
      1,
      "c20",
      true,
    ]);
    await step(() => deck.keep());
    expect(deck.done).toBe(true);

    await render(1);
    expect([deck.position, deck.total, deck.current?._id]).toEqual([
      1,
      16,
      "c20",
    ]);
  });

  test("reports a deck's start, and its counts when it ends or is left", async () => {
    await mountDeck(ids("c", 3));
    await step(() => deck.archive());
    await step(() => deck.keep());
    await step(() => deck.keep());
    expect(events).toEqual([
      ["revisit_started", {}],
      ["revisit_finished", { archived: 1, completed: true, kept: 2 }],
    ]);

    await step(() => deck.more());
    await act(() => root?.unmount());
    root = undefined;
    expect(events).toHaveLength(2);

    await mountDeck(ids("c", 3));
    await step(() => deck.keep());
    await act(() => root?.unmount());
    root = undefined;
    expect(events.slice(2)).toEqual([
      ["revisit_started", {}],
      ["revisit_finished", { archived: 0, completed: false, kept: 1 }],
    ]);
  });
});
