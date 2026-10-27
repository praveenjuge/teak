import { afterEach, expect, jest, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
URL.createObjectURL = () => "blob:preview";
URL.revokeObjectURL = () => undefined;

const never = () => new Promise(() => undefined);
let mutate: () => Promise<unknown> = never;
const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => never,
  useMutation: () => () => mutate(),
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
  mutate = never;
  jest.useRealTimers();
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

test("a stalled thumbnail upload times out and frees the controls", async () => {
  jest.useFakeTimers();
  mutate = () =>
    Promise.resolve({ fileKey: "thumb", uploadUrl: "https://r2.test/put" });
  const realFetch = globalThis.fetch;
  let puts = 0;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    puts += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      );
    });
  }) as typeof fetch;
  try {
    const hook = await renderHook("card_a");
    const file = new File([new Uint8Array(8)], "lamp.png", {
      type: "image/png",
    });
    await act(() => hook.current().replace(file, "drop"));
    expect(hook.current().isBusy).toBe(true);

    for (let step = 0; step < 20 && hook.current().isBusy; step += 1) {
      await act(async () => {
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
    }
    expect(puts).toBe(3);
    expect(hook.current().isBusy).toBe(false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
