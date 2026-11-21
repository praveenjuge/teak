import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });
const { renderToStaticMarkup } = await import("react-dom/server");

const { AppShellSkeleton } = await import("../AppShellSkeleton");
const { TestRouter, testRouter } = await import("@/__tests__/helpers/router");

const render = (path: string, defaultOpen = true) =>
  new DOMParser().parseFromString(
    renderToStaticMarkup(
      <TestRouter router={testRouter(path)}>
        <AppShellSkeleton defaultOpen={defaultOpen} defaultWidth={256} />
      </TestRouter>
    ),
    "text/html"
  ).body;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("the app frame while the vault opens", () => {
  test("names the page and shows its search over placeholder cards", () => {
    const frame = render("/favorites");
    expect(frame.querySelector("h1")?.textContent).toBe("Favorites");
    expect(frame.textContent).toContain("Search favorites");
    expect(
      frame.querySelector('a[aria-current="page"]')?.getAttribute("href")
    ).toBe("/favorites");
    expect(
      frame.querySelector('[role="status"][aria-label="Loading cards"]')
    ).not.toBeNull();
  });

  test("keeps the sidebar collapsed when it was left collapsed", () => {
    expect(
      render("/", false)
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-state")
    ).toBe("collapsed");
    expect(
      render("/", true)
        .querySelector('[data-slot="sidebar"]')
        ?.getAttribute("data-state")
    ).toBe("expanded");
  });

  test("shows the Settings card on Settings", () => {
    const frame = render("/settings");
    expect(frame.querySelector('[aria-label="Loading cards"]')).toBeNull();
    expect(frame.textContent).toContain("Settings");
  });
});
