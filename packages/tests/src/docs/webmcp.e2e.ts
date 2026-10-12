import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

test("docs WebMCP page renders with the support checker", async ({
  app,
  browser,
  screen,
}) => {
  await app.open("/docs/webmcp/");
  await expect(browser.locator("h1")).toBeVisible();
  await expect(browser.locator("body")).toContainText("teak_search_cards");
  await expect(browser.locator("body")).toContainText("teak_get_card");

  const status = screen.getByTestId("webmcp-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-supported", /true|false/);
});

test("docs llms.txt links the WebMCP page", async () => {
  const response = await fetch(`${published.siteUrl}/llms.txt`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("/docs/webmcp");
});

test("docs WebMCP markdown mirror is published", async () => {
  const response = await fetch(`${published.siteUrl}/docs/webmcp.md`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("teak_search_cards");
});

test("docs agent pages point to WebMCP", async ({ app, browser, screen }) => {
  await app.open("/docs/ai-agents/");
  await expect(
    screen.getByRole("link", { name: "WebMCP", exact: false }).first()
  ).toBeVisible();

  await app.open("/docs/mcp/");
  await expect(browser.locator("body")).toContainText("WebMCP");
});
