import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useLoadUntilMatches } = await import("../useLoadUntilMatches");
type PaginationStatus = import("../useLoadUntilMatches").PaginationStatus;

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

function setup() {
  const loadMore = mock((_pageSize: number) => undefined);
  let current = {} as ReturnType<typeof useLoadUntilMatches>;
  function Harness(props: { count: number; status: PaginationStatus }) {
    current = useLoadUntilMatches({ ...props, loadMore, pageSize: 30 });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const show = (count: number, status: PaginationStatus) =>
    act(() => root?.render(<Harness count={count} status={status} />));
  return { current: () => current, loadMore, show };
}

test("keeps asking for pages while none has matched", async () => {
  const { current, loadMore, show } = setup();
  await show(0, "CanLoadMore");
  expect(loadMore).toHaveBeenCalledTimes(1);
  expect(loadMore).toHaveBeenLastCalledWith(30);
  expect(current().isSeekingFirstMatch).toBe(true);

  await show(0, "LoadingMore");
  expect(loadMore).toHaveBeenCalledTimes(1);
  await show(0, "CanLoadMore");
  expect(loadMore).toHaveBeenCalledTimes(2);

  await show(4, "CanLoadMore");
  expect(loadMore).toHaveBeenCalledTimes(2);
  expect(current().isSeekingFirstMatch).toBe(false);
});

test("asks again when a requested page adds nothing", async () => {
  const { current, loadMore, show } = setup();
  await show(4, "CanLoadMore");
  expect(loadMore).not.toHaveBeenCalled();

  await act(() => current().requestMore());
  expect(loadMore).toHaveBeenCalledTimes(1);
  await show(4, "LoadingMore");
  await show(4, "CanLoadMore");
  expect(loadMore).toHaveBeenCalledTimes(2);

  await show(9, "CanLoadMore");
  expect(loadMore).toHaveBeenCalledTimes(2);
});

test("stops once the query is exhausted", async () => {
  const { current, loadMore, show } = setup();
  await show(0, "Exhausted");
  expect(loadMore).not.toHaveBeenCalled();
  expect(current().isSeekingFirstMatch).toBe(false);
});
