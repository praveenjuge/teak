import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
URL.createObjectURL = () => "blob:preview";
URL.revokeObjectURL = () => undefined;

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => () => new Promise(() => undefined),
  useMutation: () => () => new Promise(() => undefined),
}));
mock.module("sonner", () => ({
  toast: { error: () => undefined, success: () => undefined },
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useLinkThumbnail } = await import("../useLinkThumbnail");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

async function renderHook(initialCardId: string) {
  let hook = {} as ReturnType<typeof useLinkThumbnail>;
  function Harness({ cardId }: { cardId: string }) {
    hook = useLinkThumbnail(cardId);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(() => root?.render(<Harness cardId={initialCardId} />));
  return {
    current: () => hook,
    show: (cardId: string) =>
      act(() => root?.render(<Harness cardId={cardId} />)),
  };
}

test("an upload shows as busy, with its preview, only on its own card", async () => {
  const hook = await renderHook("card_a");
  const file = new File([new Uint8Array(8)], "lamp.png", { type: "image/png" });
  await act(() => hook.current().replace(file, "drop"));
  expect(hook.current()).toMatchObject({
    isBusy: true,
    uploadingPreviewUrl: "blob:preview",
  });

  await hook.show("card_b");
  expect(hook.current().isBusy).toBe(false);
  expect(hook.current().uploadingPreviewUrl).toBeUndefined();

  await hook.show("card_a");
  expect(hook.current().isBusy).toBe(true);
});
