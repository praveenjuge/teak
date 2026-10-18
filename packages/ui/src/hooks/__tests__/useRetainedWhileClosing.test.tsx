import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRetainedWhileClosing } = await import("../useRetainedWhileClosing");

test("a closing dialog keeps showing its last value; an open one shows the current", async () => {
  let shown: string | null | undefined;
  function Harness({ open, value }: { open: boolean; value: string | null }) {
    shown = useRetainedWhileClosing(value, open);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (open: boolean, value: string | null) =>
    act(() => root.render(<Harness open={open} value={value} />));

  await render(true, "card a");
  expect(shown).toBe("card a");
  await render(false, null);
  expect(shown).toBe("card a");
  await render(true, null);
  expect(shown).toBeNull();
  await act(() => root.unmount());
});
