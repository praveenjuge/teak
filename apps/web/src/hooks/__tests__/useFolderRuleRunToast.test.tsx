import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const undoRun = mock(async (_args: unknown) => null);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useMutation: () => undoRun,
}));

let run: Record<string, unknown> | undefined;
mock.module("@/lib/convexQueryHooks", () => ({
  useQuery: (_fn: unknown, args: unknown) =>
    args === "skip" ? undefined : run,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { toast } = await import("sonner");
const { Toaster } = await import("@/components/ui/sonner");
const { useFolderRuleRunToast } = await import("../useFolderRuleRunToast");

let root: Root | undefined;
let follow: ReturnType<typeof useFolderRuleRunToast> = () => undefined;

afterEach(() => {
  toast.dismiss();
  act(() => {
    root?.unmount();
  });
  root = undefined;
  run = undefined;
  undoRun.mockClear();
  document.body.innerHTML = "";
});

function Harness(_props: { status: string }) {
  follow = useFolderRuleRunToast();
  return null;
}

// Sonner shows a toast change on a timer after the hook's effect calls it.
const nextTick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

// Re-renders with the run in a new status.
async function showRun(status: string, extra: Record<string, unknown> = {}) {
  run = { _id: "run_1", canUndo: true, changedCount: 2, status, ...extra };
  act(() => {
    root?.render(
      <>
        <Toaster />
        <Harness status={status} />
      </>
    );
  });
  await nextTick();
}

const toastText = () =>
  document.querySelector("[data-sonner-toast]")?.textContent ?? "";
const undoButton = () =>
  [...document.querySelectorAll("[data-sonner-toast] button")].find(
    (button) => button.textContent === "Undo"
  );

test("the run's Undo goes away once the run is undoing and undone", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await showRun("running");
  act(() => {
    follow({
      folderId: "folder_1" as never,
      name: "Fonts",
      runId: "run_1" as never,
    });
  });
  await nextTick();

  await showRun("done");
  expect(toastText()).toContain("Updated 2 cards in Fonts");
  expect(undoButton()).toBeDefined();

  await showRun("undoing", { canUndo: false });
  expect(toastText()).toContain("Fonts");
  expect(undoButton()).toBeUndefined();

  await showRun("undone", { canUndo: false });
  expect(toastText()).toContain("Undid the rules run for Fonts");
  expect(undoButton()).toBeUndefined();
});
