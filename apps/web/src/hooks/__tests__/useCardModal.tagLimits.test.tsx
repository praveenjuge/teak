import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const write = mock(async (_args: unknown) => null as unknown);
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useConvex: () => ({}),
  useMutation: () =>
    Object.assign((args: unknown) => write(args), {
      withOptimisticUpdate: () => (args: unknown) => write(args),
    }),
}));
const errors: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (message: string) => errors.push(message),
    success: () => undefined,
  }),
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCardModal } = await import("../useCardModal");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  errors.length = 0;
  write.mockClear();
});

async function addTagTo(tags: string[], input: string) {
  let hook = {} as ReturnType<typeof useCardModal>;
  function Harness() {
    hook = useCardModal("card_a", {
      card: {
        _creationTime: 1,
        _id: "card_a",
        content: "card_a",
        createdAt: 1,
        tags,
        type: "text",
        updatedAt: 1,
        userId: "user_a",
      } as never,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness />));
  await act(() => hook.setTagInput(input));
  await act(() => {
    hook.addTag();
  });
  return () => hook;
}

test("a tag longer than 64 characters says why and keeps what was typed", async () => {
  const hook = await addTagTo(["work"], "a".repeat(65));
  expect(write).not.toHaveBeenCalled();
  expect(errors).toEqual(["Each tag must be at most 64 characters"]);
  expect(hook().tagInput).toBe("a".repeat(65));
});

test("a card with 100 tags says it is full", async () => {
  const tags = Array.from({ length: 100 }, (_, index) => `tag${index}`);
  await addTagTo(tags, "one more");
  expect(write).not.toHaveBeenCalled();
  expect(errors).toEqual(["A card can have at most 100 tags"]);
});

test("a 64-character tag is saved", async () => {
  await addTagTo(["work"], "a".repeat(64));
  expect(errors).toEqual([]);
  expect(write).toHaveBeenCalledTimes(1);
});
