import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDocumentTitle } = await import("../useDocumentTitle");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
});

function FolderPage({ name }: { name?: string }) {
  useDocumentTitle(name);
  return null;
}

test("names the tab after the folder, and follows a rename", async () => {
  document.title = "Folder · Teak";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root?.render(<FolderPage />));
  expect(document.title).toBe("Folder · Teak");

  await act(() => root?.render(<FolderPage name="Reading list" />));
  expect(document.title).toBe("Reading list · Teak");

  await act(() => root?.render(<FolderPage name="Read later" />));
  expect(document.title).toBe("Read later · Teak");
});

test("keeps the folder's name when the route's metadata title lands later", async () => {
  document.title = "Teak";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root?.render(<FolderPage name="Reading list" />));
  expect(document.title).toBe("Reading list · Teak");

  // A client-side navigation streams the route's generic title in after.
  document.title = "Folder · Teak";
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.title).toBe("Reading list · Teak");

  // Leaving the page lets the next route name the tab.
  await act(() => root?.unmount());
  root = undefined;
  document.title = "Everything · Teak";
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.title).toBe("Everything · Teak");
});
