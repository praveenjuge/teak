import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { ConvexError } from "convex/values";
import type { Root } from "react-dom/client";
import type { TagOperationView } from "../../lib/tags";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let latest: TagOperationView | null = null;
let followed: TagOperationView | null = null;
const startMutation = mock(
  async (_input: unknown): Promise<TagOperationView | undefined> => undefined
);
const toastError = mock(
  (_title: string, _options?: { action?: { onClick: () => void } }) => undefined
);

mock.module("convex/react", () => ({ useMutation: () => startMutation }));
mock.module("convex-helpers/react/cache/hooks", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") {
      return;
    }
    return args && typeof args === "object" && "operationId" in args
      ? followed
      : latest;
  },
}));
mock.module("sonner", () => ({
  toast: {
    error: toastError,
    loading: () => undefined,
    success: () => undefined,
  },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useTagOperations } = await import("../useTagOperations");
const { TAG_OPERATION_OVERLAY_MS } = await import("../../lib/tags");

let root: Root | undefined;
let hook: ReturnType<typeof useTagOperations>;

function Harness() {
  hook = useTagOperations();
  return null;
}

const operation = (
  overrides: Partial<TagOperationView> = {}
): TagOperationView => ({
  _id: "op1",
  kind: "rename",
  from: "design",
  to: "Design Systems",
  status: "running",
  total: 300,
  processed: 120,
  changed: 120,
  updatedAt: Date.now(),
  ...overrides,
});

const render = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root?.render(<Harness />));
};

beforeEach(() => {
  latest = null;
  followed = null;
  startMutation.mockReset();
  toastError.mockReset();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("a finished change stops adjusting the tag list once its time is up", async () => {
  latest = operation({
    status: "completed",
    completedAt: Date.now() - TAG_OPERATION_OVERLAY_MS + 40,
  });
  await render();
  expect(hook.latest?._id).toBe("op1");

  await act(() => new Promise((resolve) => setTimeout(resolve, 120)));
  expect(hook.latest).toBeNull();
});

test("Retry on a rename that got part way merges the rest into the new name", async () => {
  latest = operation();
  followed = operation({ status: "failed" });
  startMutation.mockImplementationOnce(() => {
    throw new ConvexError({ code: "TAG_EXISTS", message: "exists" });
  });
  startMutation.mockImplementationOnce(async () =>
    operation({ _id: "op2", kind: "merge" })
  );
  await render();

  const retry = toastError.mock.calls.at(-1)?.[1]?.action?.onClick;
  expect(retry).toBeDefined();
  await act(async () => {
    retry?.();
    await Promise.resolve();
  });

  expect(startMutation.mock.calls.map(([input]) => input)).toEqual([
    { kind: "rename", from: "design", to: "Design Systems" },
    { kind: "merge", from: "design", to: "Design Systems" },
  ]);
});
