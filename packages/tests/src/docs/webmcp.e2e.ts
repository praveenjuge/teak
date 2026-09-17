import { expect, test } from "@playwright/test";

test("docs WebMCP page renders with the support checker", async ({ page }) => {
  await page.goto("/docs/webmcp/");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("body")).toContainText("teak_search_cards");
  await expect(page.locator("body")).toContainText("teak_get_card");

  const status = page.getByTestId("webmcp-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-supported", /true|false/);
});

test("docs llms.txt links the WebMCP page", async ({ page }) => {
  const response = await page.request.get("/llms.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("/docs/webmcp");
});

test("docs WebMCP markdown mirror is published", async ({ page }) => {
  const response = await page.request.get("/docs/webmcp.md");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("teak_search_cards");
});

test("docs agent pages point to WebMCP", async ({ page }) => {
  await page.goto("/docs/ai-agents/");
  await expect(
    page.getByRole("link", { name: "WebMCP" }).first()
  ).toBeVisible();

  await page.goto("/docs/mcp/");
  await expect(page.locator("body")).toContainText("WebMCP");
});
