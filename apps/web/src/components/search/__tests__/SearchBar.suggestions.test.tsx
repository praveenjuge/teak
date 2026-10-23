import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SearchBar } = await import("../SearchBar");

const sources = {
  tags: [{ name: "design", count: 4 }],
  folders: [{ name: "Reading list" }],
  sites: [{ host: "github.com", label: "github.com", count: 3 }],
};

let root: Root | undefined;
let container: HTMLDivElement;
let chips: string[];
let pageKeys: string[];

function Harness({ initialChips = [] }: { initialChips?: string[] }) {
  const [query, setQuery] = useState("");
  const [qualifiers, setQualifiers] = useState(initialChips);
  chips = qualifiers;
  return (
    <SearchBar
      filterTags={[]}
      hexFilters={[]}
      hueFilters={[]}
      keywordTags={[]}
      onAddQualifier={(chip) => setQualifiers((prev) => [...prev, chip])}
      onClearAll={() => setQualifiers([])}
      onKeyDown={(event) => pageKeys.push(event.key)}
      onRemoveFilter={() => undefined}
      onRemoveHexFilter={() => undefined}
      onRemoveHueFilter={() => undefined}
      onRemoveKeyword={() => undefined}
      onRemoveQualifier={(chip) =>
        setQualifiers((prev) => prev.filter((item) => item !== chip))
      }
      onRemoveStyleFilter={() => undefined}
      onRemoveTimeFilter={() => undefined}
      onSearchChange={setQuery}
      qualifierChips={qualifiers}
      searchQuery={query}
      styleFilters={[]}
      suggestionSources={sources}
    />
  );
}

const input = () =>
  container.querySelector("input[role=combobox]") as HTMLInputElement;
const options = () =>
  [...container.querySelectorAll("[role=option]")].map((option) =>
    option.textContent?.trim()
  );

const type = async (text: string) => {
  await act(() => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    setter?.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const press = async (key: string) => {
  await act(() => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });
};

beforeEach(async () => {
  chips = [];
  pageKeys = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

test("a key, then its values, become a chip with Enter", async () => {
  await type("notes si");
  expect(options()).toEqual(["site:Links from a website"]);
  expect(input().getAttribute("aria-expanded")).toBe("true");
  await press("ArrowDown");
  await press("Enter");
  expect(input().value).toBe("notes site:");
  expect(options()).toEqual(["github.com3"]);
  await press("Enter");
  expect(chips).toEqual(["site:github.com"]);
  expect(input().value).toBe("notes");
  expect(pageKeys).toEqual([]);
});

test("Escape closes the list and keeps the text, not the page", async () => {
  await type("tag:de");
  expect(options()).toEqual(["design4"]);
  await press("Escape");
  expect(options()).toEqual([]);
  expect(input().value).toBe("tag:de");
  expect(pageKeys).toEqual([]);
  await press("Enter");
  expect(pageKeys).toEqual(["Enter"]);
});

test("chips read as labels, and an unknown folder says so", async () => {
  await act(async () =>
    root?.render(
      <Harness
        initialChips={[
          'folder:"Reading list"',
          "folder:Nope",
          "site:github.com",
        ]}
        key="with-chips"
      />
    )
  );
  const labels = [...container.querySelectorAll("button[aria-label]")].map(
    (button) => button.getAttribute("aria-label")
  );
  expect(labels).toContain("Remove folder Reading list");
  expect(labels).toContain("Remove folder:Nope: no folder named Nope");
  expect(labels).toContain("Remove site github.com");
  expect(container.textContent).toContain("No folder named Nope");
});

test("a minus offers exclusions, and the picked one is an excluded chip", async () => {
  await type("-");
  expect(options()).toEqual([
    "-tag:Leave out cards with a tag",
    "-type:Leave out links, images, notes…",
    "-site:Leave out links from a website",
    "-folder:Leave out cards in a folder",
    "-is:Leave out favorites, archived, done…",
  ]);
  expect(container.textContent).toContain("Exclude");
  await press("ArrowDown");
  await press("Enter");
  expect(input().value).toBe("-tag:");
  expect(options()).toEqual(["design4"]);
  await press("Enter");
  expect(chips).toEqual(["-tag:design"]);
  const chip = container.querySelector(
    'button[aria-label="Remove excluding tag design"]'
  );
  expect(chip?.textContent).toContain("−");
  expect(chip?.querySelector(".line-through")?.textContent).toBe("design");
  expect(chip?.getAttribute("title")).toBe("Tag not design");
});

test("OR is offered after a word, and inserts itself", async () => {
  await type("O");
  expect(options()).toEqual([]);
  await type("design O");
  expect(options()).toEqual(["OREither side matches"]);
  await press("ArrowDown");
  await press("Enter");
  expect(input().value).toBe("design OR ");
});
