import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { NoSearchResults } = await import("../NoSearchResults");
const { SearchResultsSummary } = await import("../SearchResultsSummary");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const render = async (element: React.ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() => root?.render(element));
};

const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (item) =>
      item.getAttribute("aria-label") === name ||
      item.textContent?.trim() === name
  );

describe("SearchResultsSummary", () => {
  test("counts the matches and the cards related only by meaning", async () => {
    const onShowRelatedChange = mock((_show: boolean) => undefined);
    await render(
      <SearchResultsSummary
        exactCount={5}
        hasMore={false}
        onShowRelatedChange={onShowRelatedChange}
        relatedCount={12}
        showRelated
      />
    );
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "5 cards match · 12 related by meaning"
    );
    await act(() => button("Hide related")?.click());
    expect(onShowRelatedChange).toHaveBeenCalledWith(false);
  });

  test("says more can load, and offers nothing to hide without related cards", async () => {
    await render(
      <SearchResultsSummary
        exactCount={50}
        hasMore
        onShowRelatedChange={() => undefined}
        relatedCount={0}
        showRelated
      />
    );
    expect(document.body.textContent).toBe("50+ cards match");
    expect(button("Hide related")).toBeUndefined();
  });
});

describe("NoSearchResults", () => {
  test("names the search, offers a spelling, and drops one filter at a time", async () => {
    const onUseSuggestion = mock((_search: string) => undefined);
    const removeHeron = mock(() => undefined);
    await render(
      <NoSearchResults
        chips={[
          { key: "a", label: "kestral", onRemove: () => undefined },
          { key: "b", label: "−heron", onRemove: removeHeron },
        ]}
        onClearAll={() => undefined}
        onUseSuggestion={onUseSuggestion}
        query="kestral -heron"
        suggestion="kestrel -heron"
      />
    );
    expect(document.body.textContent).toContain(
      "Nothing found for “kestral -heron”"
    );
    expect(document.body.textContent).toContain("Did you mean kestrel -heron?");
    await act(() => button("kestrel -heron")?.click());
    expect(onUseSuggestion).toHaveBeenCalledWith("kestrel -heron");
    await act(() => button("Remove −heron")?.click());
    expect(removeHeron).toHaveBeenCalledTimes(1);
    expect(button("Clear filters")).toBeDefined();
  });

  test("keeps the filters message when nothing was typed", async () => {
    await render(
      <NoSearchResults
        chips={[{ key: "a", label: "Link", onRemove: () => undefined }]}
        onClearAll={() => undefined}
        query=""
      />
    );
    expect(document.body.textContent).toContain(
      "Nothing found matching your filters"
    );
    expect(document.body.textContent).not.toContain("Did you mean");
    expect(button("Remove Link")).toBeUndefined();
  });
});
