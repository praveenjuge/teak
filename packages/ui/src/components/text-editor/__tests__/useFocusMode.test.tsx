import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useFocusMode } = await import("../useFocusMode");

test("the inline editor keeps its text while Focus is open and catches up on close", async () => {
  let focus = {} as ReturnType<typeof useFocusMode>;
  function Harness({ content }: { content: string }) {
    focus = useFocusMode(content);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(() => root.render(<Harness content="draft" />));
  expect(focus.isFocusOpen).toBe(false);

  await act(() => focus.open());
  await act(() => root.render(<Harness content="draft, longer" />));
  expect(focus.isFocusOpen).toBe(true);
  expect(focus.inlineEditorValue).toBe("draft");

  await act(() => focus.close());
  expect(focus.isFocusOpen).toBe(false);
  expect(focus.inlineEditorValue).toBe("draft, longer");
  await act(() => root.unmount());
});
