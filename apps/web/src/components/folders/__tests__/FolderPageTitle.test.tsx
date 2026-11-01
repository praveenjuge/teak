import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { FolderPageTitle } = await import("../FolderPageTitle");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const renderTitle = async (
  folder: Parameters<typeof FolderPageTitle>[0]["folder"]
) => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root?.render(
      <FolderPageTitle folder={folder} onEditSearch={() => undefined} />
    )
  );
  return document.querySelector("h1")?.textContent;
};

test("a missing folder's heading says it wasn't found, like its tab", async () => {
  expect(await renderTitle(null)).toBe("Folder not found");
});

test("a folder still loading keeps the plain Folder heading", async () => {
  expect(await renderTitle(undefined)).toBe("Folder");
});
