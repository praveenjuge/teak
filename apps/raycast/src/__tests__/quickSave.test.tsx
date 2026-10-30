import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement } from "react";
import { mockRaycastUi, setClipboard } from "./raycastUiMock";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
mockRaycastUi();
const { default: QuickSaveCommand } = await import("../quick-save");

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
const contentField = () =>
  container.querySelector('[data-name="Form.TextArea"]')?.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => {
    root.unmount();
  });
  container.remove();
});
afterAll(() => GlobalRegistrator.unregister());

test("fills Content with copied text", async () => {
  setClipboard({ text: "https://example.com/article" });
  act(() => {
    root.render(createElement(QuickSaveCommand));
  });
  await settle();
  expect(contentField()).toContain("https://example.com/article");
});

test("leaves Content empty when a file is copied", async () => {
  setClipboard({ file: "/Users/me/Report.docx", text: "Report.docx" });
  act(() => {
    root.render(createElement(QuickSaveCommand));
  });
  await settle();
  expect(contentField()).not.toContain("Report.docx");
});
