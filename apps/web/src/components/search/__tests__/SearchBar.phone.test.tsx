import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SearchBar } = await import("../SearchBar");

let root: Root | undefined;
const width = window.innerWidth;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
});

const noop = () => undefined;

test("a phone keeps one readable chip in the field and folds the rest", async () => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(() =>
    root?.render(
      <SearchBar
        filterTags={["link"]}
        hexFilters={[]}
        hueFilters={[]}
        keywordTags={["design", "ideas"]}
        onClearAll={noop}
        onKeyDown={noop}
        onRemoveFilter={noop}
        onRemoveHexFilter={noop}
        onRemoveHueFilter={noop}
        onRemoveKeyword={noop}
        onRemoveStyleFilter={noop}
        onRemoveTimeFilter={noop}
        onSearchChange={noop}
        placeholder="Search everything"
        searchQuery=""
        styleFilters={[]}
      />
    )
  );
  const form = host.querySelector("form");
  const chips = [...(form?.querySelectorAll("button") ?? [])]
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((name) => name.startsWith("Remove "));
  expect(chips).toEqual(["Remove design"]);
  expect(form?.querySelector('[aria-label="2 more filters"]')).not.toBeNull();
});
