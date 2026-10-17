import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let write = mock(async (_args: unknown) => null as unknown);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({}),
  useMutation: () =>
    Object.assign((args: unknown) => write(args), {
      withOptimisticUpdate: () => (args: unknown) => write(args),
    }),
}));
let undo: (() => void) | undefined;
mock.module("sonner", () => ({
  toast: Object.assign(
    (_message: string, options?: { action?: { onClick: () => void } }) => {
      undo = options?.action?.onClick;
    },
    { error: () => undefined, success: () => undefined }
  ),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardModal } = await import("../useCardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  undo = undefined;
});

const cardOf = (id: string, tags: string[]) =>
  ({
    _creationTime: 1,
    _id: id,
    content: id,
    createdAt: 1,
    tags,
    type: "text",
    updatedAt: 1,
    userId: "user_a",
  }) as never;

/** The hook as the dialog uses it, showing whichever card it is given. */
async function renderHook(id: string | null, tags: string[]) {
  let hook = {} as ReturnType<typeof useCardModal>;
  function Harness(props: { id: string | null; tags: string[] }) {
    hook = useCardModal(props.id, {
      card: props.id ? cardOf(props.id, props.tags) : null,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness id={id} tags={tags} />));
  return {
    hook: () => hook,
    show: (nextId: string | null, nextTags: string[] = []) =>
      act(() => root?.render(<Harness id={nextId} tags={nextTags} />)),
  };
}

const hideCardA = async () => {
  write = mock(async () => null);
  const view = await renderHook("card_a", ["work"]);
  await act(() => view.hook().setTagInput("secret"));
  await act(() => {
    view.hook().addTag();
  });
  expect(undo).toBeDefined();
  return view;
};

const lastWrite = () => write.mock.calls[write.mock.calls.length - 1]?.[0];

test("Undo removes only the added tag, keeping a later edit to the same card", async () => {
  const view = await hideCardA();
  await view.show("card_a", ["work", "secret", "later"]);
  await act(async () => undo?.());
  expect(lastWrite()).toMatchObject({
    cardId: "card_a",
    field: "tags",
    value: ["work", "later"],
  });
});

test("Undo after moving to another card restores the hidden card's own tags", async () => {
  const view = await hideCardA();
  await view.show("card_b", ["other"]);
  await act(async () => undo?.());
  expect(lastWrite()).toMatchObject({
    cardId: "card_a",
    field: "tags",
    value: ["work"],
  });
});

test("Undo after closing the dialog restores the hidden card's own tags", async () => {
  const view = await hideCardA();
  await view.show(null);
  await act(async () => undo?.());
  expect(lastWrite()).toMatchObject({
    cardId: "card_a",
    field: "tags",
    value: ["work"],
  });
});
