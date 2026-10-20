import {
  afterEach,
  beforeEach,
  expect,
  jest,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Answer {
  reject: (error: Error) => void;
  resolve: (outcome: string) => void;
}
const answers: Answer[] = [];
const requestRelevanceScores = mock(
  (_args: Record<string, unknown>) =>
    new Promise<{ outcome: string }>((resolve, reject) => {
      answers.push({ resolve: (outcome) => resolve({ outcome }), reject });
    })
);

mock.module("convex/react", () => ({
  useAction: () => requestRelevanceScores,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRelevanceRanking } = await import("../useRelevanceRanking");

let root: Root | undefined;
let state = { holding: false, useRelevanceScores: false };

function Harness(props: Parameters<typeof useRelevanceRanking>[0]) {
  state = useRelevanceRanking(props);
  return null;
}

const render = async (props: Parameters<typeof useRelevanceRanking>[0]) => {
  const container = document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(() => {
    root?.render(<Harness {...props} />);
  });
};

const answer = (settle: () => void) =>
  act(async () => {
    settle();
    await Promise.resolve();
  });

beforeEach(() => {
  jest.useFakeTimers();
  answers.length = 0;
  requestRelevanceScores.mockClear();
});

afterEach(async () => {
  await act(() => {
    root?.unmount();
  });
  root = undefined;
  jest.useRealTimers();
  setSystemTime();
});

test("does nothing outside Best match or without words to match", async () => {
  await render({ searchQuery: "lentil soup" });
  await render({ searchQuery: "type:link", sort: "relevance" });
  expect(requestRelevanceScores).not.toHaveBeenCalled();
  expect(state).toEqual({ holding: false, useRelevanceScores: false });
});

test("holds, then orders by scores that arrive in time", async () => {
  await render({ searchQuery: "lentil soup", sort: "relevance" });
  expect(state).toEqual({ holding: true, useRelevanceScores: false });
  expect(requestRelevanceScores).toHaveBeenCalledWith({
    searchQuery: "lentil soup",
    sort: "relevance",
  });
  await answer(() => answers[0]?.resolve("ok"));
  expect(state).toEqual({ holding: false, useRelevanceScores: true });
});

test("late scores never reorder the search", async () => {
  await render({ searchQuery: "lentil soup", sort: "relevance" });
  await act(() => {
    jest.advanceTimersByTime(400);
  });
  expect(state).toEqual({ holding: false, useRelevanceScores: false });
  await answer(() => answers[0]?.resolve("ok"));
  expect(state).toEqual({ holding: false, useRelevanceScores: false });
});

test.each(["rate_limited", "unavailable", "skipped"])(
  "a %s answer keeps the unscored order",
  async (outcome) => {
    await render({ searchQuery: "lentil soup", sort: "relevance" });
    await answer(() => answers[0]?.resolve(outcome));
    expect(state).toEqual({ holding: false, useRelevanceScores: false });
  }
);

test("a new filter on the same words asks again", async () => {
  await render({ searchQuery: "lentil soup", sort: "relevance" });
  await answer(() => answers[0]?.resolve("ok"));
  await render({
    searchQuery: "lentil soup",
    sort: "relevance",
    types: ["link"],
  });
  expect(requestRelevanceScores).toHaveBeenCalledTimes(2);
  expect(state.holding).toBe(true);
});
