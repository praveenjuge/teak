import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Target {
  id: string;
  missing: boolean;
  title: string | null;
}
const answers = new Map<string, Target[]>();
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({ query: async () => [] }),
}));
mock.module("../../lib/convexQueryHooks", () => ({
  useQuery: (_query: unknown, args: "skip" | { cardIds: string[] }) =>
    args === "skip" ? undefined : answers.get(args.cardIds.join(",")),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { formatCardLinkToken } = await import("@teak/convex/shared/cardLinks");
const { useCardLinkEditor } = await import("../useCardLinkEditor");

const A = "a".repeat(32);
const B = "b".repeat(32);
let root: Root | undefined;
let hook = {} as ReturnType<typeof useCardLinkEditor>;

function Harness({ value }: { value: string }) {
  hook = useCardLinkEditor({ value });
  return null;
}

const render = async (value: string) => {
  root ??= createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness value={value} />));
};

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  answers.clear();
});

test("keeps the last targets while a changed id list loads", async () => {
  answers.set(A, [{ id: A, missing: true, title: null }]);
  await render(formatCardLinkToken("Gone", A));
  expect(hook.targets?.get(A)?.missing).toBe(true);

  // A second link is added; its query has no answer yet.
  await render(
    `${formatCardLinkToken("Gone", A)} ${formatCardLinkToken("New", B)}`
  );
  expect(hook.targets?.get(A)?.missing).toBe(true);
  expect(hook.targets?.has(B)).toBe(false);

  answers.set(`${A},${B}`, [
    { id: A, missing: true, title: null },
    { id: B, missing: false, title: "Live title" },
  ]);
  await render(
    `${formatCardLinkToken("Gone", A)} ${formatCardLinkToken("New", B)}  `
  );
  expect(hook.targets?.get(B)?.title).toBe("Live title");
});

test("has no targets when the note links nowhere", async () => {
  await render("No links here");
  expect(hook.targets).toBeUndefined();
});
