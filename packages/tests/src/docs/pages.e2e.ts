import { expect, test } from "@playwright/test";

for (const path of ["/docs/", "/docs/api/", "/docs/mcp/", "/docs/cli/"]) {
  test(`docs key page ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).toContainText(/Teak|API|MCP|CLI/);
  });
}

test("docs Pagefind assets are published", async ({ page }) => {
  for (const path of [
    "/pagefind/pagefind.js",
    "/pagefind/pagefind-ui.js",
    "/pagefind/pagefind-ui.css",
    "/pagefind/pagefind-entry.json",
  ]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
  }
});
