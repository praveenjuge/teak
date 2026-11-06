import { afterEach, expect, mock, test } from "bun:test";
import "@/__tests__/helpers/nextRouter";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const saves: unknown[] = [];
let finishSave: (() => void) | undefined;
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => {
  const create = (args: unknown) => {
    saves.push(args);
    return new Promise((resolve) => {
      finishSave = () => resolve({ cardId: "card-1", outcome: "created" });
    });
  };
  return {
    ...realConvexReact,
    useMutation: () =>
      Object.assign(create, { withOptimisticUpdate: () => create }),
  };
});
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: () => undefined,
    info: () => undefined,
    loading: () => "toast",
    success: () => undefined,
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useSaveSearchAsNote } = await import("../useSaveNote");

let root: Root | undefined;
let note = {} as ReturnType<typeof useSaveSearchAsNote>;

function Harness({ noteText }: { noteText: string | null }) {
  note = useSaveSearchAsNote({ noteText });
  return null;
}

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  saves.length = 0;
  finishSave = undefined;
});

async function render(noteText: string | null) {
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness noteText={noteText} />));
}

test("a second tap while the first save is in flight saves nothing more", async () => {
  await render("call the dentist");
  await act(() => {
    note.save?.();
    note.save?.();
  });
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ content: "call the dentist" });
  expect(note.saving).toBe(true);

  await act(async () => {
    finishSave?.();
    await Promise.resolve();
  });
  expect(note.saving).toBe(false);
  await act(() => note.save?.());
  expect(saves).toHaveLength(2);
});

test("offers nothing to save without words", async () => {
  await render(null);
  expect(note.save).toBeUndefined();
});
