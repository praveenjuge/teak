import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const realConvexReact = await import("convex/react");
const mutation = () =>
  Object.assign(mock(), { withOptimisticUpdate: () => mock() });
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => mock(),
  useMutation: mutation,
}));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: () => undefined,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MasonryGrid } = await import("../MasonryGrid");

// The browser is the boundary here. Like a real IntersectionObserver, each
// observer reports its target's state when it starts observing and again on
// every change, and the browser hands over everything queued since the last
// delivery in one callback.
let sentinelInView = false;
const observers = new Set<FakeIntersectionObserver>();

class FakeIntersectionObserver {
  private readonly queued: IntersectionObserverEntry[] = [];
  private target: Element | null = null;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.target = target;
    observers.add(this);
    this.queue();
  }

  disconnect() {
    this.target = null;
    this.queued.length = 0;
    observers.delete(this);
  }

  unobserve() {
    this.disconnect();
  }

  takeRecords() {
    return this.queued.splice(0);
  }

  queue() {
    if (this.target) {
      this.queued.push({
        isIntersecting: sentinelInView,
        target: this.target,
      } as IntersectionObserverEntry);
    }
  }

  deliver() {
    const entries = this.takeRecords();
    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }
}

const scrollSentinel = (inView: boolean) => {
  sentinelInView = inView;
  for (const observer of observers) {
    observer.queue();
  }
};

const deliverIntersections = async () => {
  for (let round = 0; round < 10; round += 1) {
    const pending = [...observers];
    if (pending.length === 0) {
      return;
    }
    await act(() => {
      for (const observer of pending) {
        observer.deliver();
      }
    });
  }
};

const realIntersectionObserver = globalThis.IntersectionObserver;
let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  sentinelInView = false;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  observers.clear();
  document.body.innerHTML = "";
  globalThis.IntersectionObserver = realIntersectionObserver;
});

const cards = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      ({
        _creationTime: 1,
        _id: `card_${index}`,
        content: `Card ${index}`,
        createdAt: 1,
        type: "text",
        updatedAt: 1,
        userId: "user_123",
      }) as any
  );

const handlers = {
  onCardClick: mock(),
  onDeleteCard: mock(async () => true),
};

const gridElement = (props: Record<string, unknown>) => (
  <MasonryGrid
    batchSize={30}
    columns={1}
    filteredCards={[]}
    hasMore
    initialBatchSize={30}
    {...handlers}
    {...props}
  />
);

const renderGrid = async (props: Record<string, unknown>) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(gridElement(props)));
};

const rerenderGrid = async (props: Record<string, unknown>) => {
  await act(() => root?.render(gridElement(props)));
};

const visibleCardCount = () =>
  container.querySelectorAll("[data-card-id]").length;

describe("MasonryGrid infinite scroll", () => {
  test("scrolling to the bottom shows loaded cards even when the observer's first report was out of view", async () => {
    await renderGrid({ filteredCards: cards(60), onLoadMore: mock() });
    expect(visibleCardCount()).toBe(30);

    scrollSentinel(true);
    await deliverIntersections();

    expect(visibleCardCount()).toBe(60);
  });

  test("a page that arrives while the bottom stays in view is shown without more scrolling", async () => {
    const onLoadMore = mock();
    sentinelInView = true;
    await renderGrid({ filteredCards: cards(30), onLoadMore });
    await deliverIntersections();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(visibleCardCount()).toBe(30);

    await rerenderGrid({ filteredCards: cards(60), onLoadMore });
    await deliverIntersections();

    expect(visibleCardCount()).toBe(60);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  test("a page that adds no new cards still lets the bottom ask for the next one", async () => {
    // A search shows cached cards with the server's pages, so a page of cards
    // already on screen leaves the count unchanged.
    const onLoadMore = mock();
    const shown = cards(30);
    sentinelInView = true;
    await renderGrid({ filteredCards: shown, onLoadMore });
    await deliverIntersections();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await rerenderGrid({
      filteredCards: shown,
      isLoadingMore: true,
      onLoadMore,
    });
    await deliverIntersections();
    await rerenderGrid({
      filteredCards: shown,
      isLoadingMore: false,
      onLoadMore,
    });
    await deliverIntersections();

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  test("j past the last card asks for the next page again once a page adds nothing new", async () => {
    const onLoadMore = mock();
    const shown = cards(2);
    await renderGrid({ filteredCards: shown, onLoadMore });
    const last = container.querySelector<HTMLElement>(
      '[data-card-id="card_1"]'
    );
    const pressJ = () =>
      act(() => {
        last?.focus();
        last?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "j" })
        );
      });
    await pressJ();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await rerenderGrid({
      filteredCards: shown,
      isLoadingMore: true,
      onLoadMore,
    });
    await rerenderGrid({
      filteredCards: shown,
      isLoadingMore: false,
      onLoadMore,
    });
    await pressJ();

    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  test("the bottom doesn't ask again while a page is still loading", async () => {
    const onLoadMore = mock();
    const shown = cards(30);
    sentinelInView = true;
    await renderGrid({ filteredCards: shown, onLoadMore });
    await deliverIntersections();
    await rerenderGrid({
      filteredCards: shown,
      isLoadingMore: true,
      onLoadMore,
    });
    scrollSentinel(false);
    await deliverIntersections();
    scrollSentinel(true);
    await deliverIntersections();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
