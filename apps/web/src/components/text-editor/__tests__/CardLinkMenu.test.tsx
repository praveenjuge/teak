import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CardLinkMenu, type CardLinkMenuState } from "../CardLinkMenu";
import { cardLinkPillState } from "../CardLinkPill";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const noop = () => undefined;

describe("CardLinkMenu", () => {
  test("lists cards as options, marking the selected one", () => {
    const html = renderToStaticMarkup(
      <CardLinkMenu
        onChoose={noop}
        query="gar"
        selected={1}
        state={{
          items: [
            { id: "a", title: "Garden plan", type: "text" },
            { id: "b", title: "Garage sale", type: "link" },
          ],
          status: "ready",
        }}
      />
    );
    expect(html).toContain('aria-label="Link a card"');
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toContain("Garden plan");
    expect(html).toMatch(/aria-selected="true"[^>]*>.*Garage sale/);
  });

  test.each([
    ["gar", "No matching cards"],
    ["", "No cards yet"],
  ])("with no results for %p says %s", (query, message) => {
    const html = renderToStaticMarkup(
      <CardLinkMenu
        onChoose={noop}
        query={query}
        selected={0}
        state={{ items: [], status: "ready" }}
      />
    );
    expect(html).toContain(message);
    expect(html).not.toContain('role="option"');
    expect(html).toMatch(/role="listbox"><\/div>/);
  });

  test("shows a skeleton row while searching, and says when search failed", () => {
    expect(
      renderToStaticMarkup(
        <CardLinkMenu
          onChoose={noop}
          query="x"
          selected={0}
          state={{ status: "loading" }}
        />
      )
    ).toContain('aria-busy="true"');
    expect(
      renderToStaticMarkup(
        <CardLinkMenu
          onChoose={noop}
          query="x"
          selected={0}
          state={{ status: "error" }}
        />
      )
    ).toContain("Couldn&#x27;t search cards");
  });
});

describe("CardLinkMenu in the editor", () => {
  const ready: CardLinkMenuState = {
    items: [
      { id: "a", title: "Garden plan", type: "text" },
      { id: "b", title: "Garage sale", type: "link" },
    ],
    status: "ready",
  };
  let root: Root | undefined;
  let editor: HTMLElement;

  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
  });

  async function render(
    selected: number,
    onChoose: (item: { id: string }) => void = noop
  ) {
    if (!root) {
      editor = document.createElement("div");
      const container = document.createElement("div");
      document.body.append(editor, container);
      root = createRoot(container);
    }
    await act(() =>
      root?.render(
        <CardLinkMenu
          anchor={{ dom: editor }}
          onChoose={onChoose}
          query="gar"
          selected={selected}
          state={ready}
        />
      )
    );
  }

  const optionId = (name: string) =>
    [...document.querySelectorAll("[role=option]")].find((option) =>
      option.textContent?.includes(name)
    )?.id;

  test("clicking an option chooses that card", async () => {
    const onChoose = mock();
    await render(0, onChoose);
    await act(() => {
      document
        .querySelector<HTMLElement>(`[id="${optionId("Garage sale")}"]`)
        ?.click();
    });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0]).toMatchObject({ id: "b" });
  });

  test("the editor points at the selected option, and stops when the menu closes", async () => {
    await render(0);
    expect(editor.getAttribute("aria-activedescendant")).toBe(
      optionId("Garden plan")
    );
    expect(editor.getAttribute("aria-controls")).toBe(
      document.querySelector("[role=listbox]")?.id
    );

    await render(1);
    expect(editor.getAttribute("aria-activedescendant")).toBe(
      optionId("Garage sale")
    );

    await act(() => root?.unmount());
    root = undefined;
    expect(editor.hasAttribute("aria-activedescendant")).toBe(false);
    expect(editor.hasAttribute("aria-controls")).toBe(false);
  });
});

describe("card link pills", () => {
  const targets = new Map([
    ["live", { id: "live", missing: false, title: "Renamed", type: "text" }],
    ["gone", { id: "gone", missing: true, title: null, type: null }],
  ]);

  test("show the live title, the stored one while loading, or missing", () => {
    expect(cardLinkPillState("live", "Old", targets)).toMatchObject({
      missing: false,
      title: "Renamed",
    });
    expect(cardLinkPillState("live", "Old", undefined)).toMatchObject({
      missing: false,
      title: "Old",
    });
    expect(cardLinkPillState("gone", "Old", targets)).toMatchObject({
      missing: true,
      title: "Missing card",
    });
  });
});
