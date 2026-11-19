import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Answer {
  reject: (error: Error) => void;
  resolve: () => void;
}
const answers: Answer[] = [];
const requestSemanticResults = mock(
  (_args: Record<string, unknown>) =>
    new Promise<{ outcome: string }>((resolve, reject) => {
      answers.push({ resolve: () => resolve({ outcome: "ok" }), reject });
    })
);

mock.module("convex/react", () => ({
  useAction: () => requestSemanticResults,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { semanticSearchText } = await import("../../lib/cardsSearchState");
const {
  SEMANTIC_EMPTY_STATE_WAIT_MS,
  SEMANTIC_RESULTS_LAND_MS,
  useSemanticSearch,
} = await import("../useSemanticSearch");

let root: Root | undefined;
let pending = false;
let outcome: string | null = null;

function Harness(props: Parameters<typeof useSemanticSearch>[0]) {
  const state = useSemanticSearch(props);
  pending = state.isPending;
  outcome = state.outcome;
  return null;
}

const answer = (settle: () => void) =>
  act(async () => {
    settle();
    await Promise.resolve();
  });

const render = async (props: Parameters<typeof useSemanticSearch>[0]) => {
  const container = document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(() => {
    root?.render(<Harness {...props} />);
  });
};

beforeEach(() => {
  answers.length = 0;
  requestSemanticResults.mockClear();
});

afterEach(async () => {
  await act(() => {
    root?.unmount();
  });
  root = undefined;
});

test("asks for meaning matches only when the search has free words", async () => {
  await render({ searchQuery: "tag:design type:link" });
  expect(requestSemanticResults).not.toHaveBeenCalled();
  expect(pending).toBe(false);

  jest.useFakeTimers();
  try {
    await render({ searchQuery: "cozy reading nook" });
    expect(requestSemanticResults).toHaveBeenCalledWith({
      searchQuery: "cozy reading nook",
    });
    expect(pending).toBe(true);
    // A cold meaning search takes about 2 s: the empty state waits for it.
    await act(() => jest.advanceTimersByTime(2500));
    expect(pending).toBe(true);
    await answer(() => answers[0]?.resolve());
    // The stored ranking reaches the grid's query just after the answer.
    expect(pending).toBe(true);
    await act(() => jest.advanceTimersByTime(SEMANTIC_RESULTS_LAND_MS));
    expect(pending).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("stops waiting when the action never answers", async () => {
  jest.useFakeTimers();
  try {
    await render({ searchQuery: "cozy reading nook" });
    await act(() => jest.advanceTimersByTime(SEMANTIC_EMPTY_STATE_WAIT_MS));
    expect(pending).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test("an older answer does not end a newer search's wait", async () => {
  await render({ searchQuery: "first search" });
  await render({ searchQuery: "second search" });
  await answer(() => answers[0]?.resolve());
  expect(pending).toBe(true);
  await answer(() => answers[1]?.reject(new Error("unavailable")));
  expect(pending).toBe(false);
});

test("an older answer that lands late keeps the newer search's outcome", async () => {
  await render({ searchQuery: "first search" });
  await render({ searchQuery: "second search" });
  await answer(() => answers[1]?.reject(new Error("unavailable")));
  expect(outcome).toBe("unavailable");
  await answer(() => answers[0]?.resolve());
  expect(outcome).toBe("unavailable");
  expect(pending).toBe(false);
});

test("skips a disabled view and counts a smart folder's words", async () => {
  await render({ searchQuery: "chair", enabled: false });
  expect(requestSemanticResults).not.toHaveBeenCalled();
  expect(semanticSearchText("", "cozy type:image")).toBe("cozy");
  expect(semanticSearchText("tag:home", "type:image")).toBe("");
});
