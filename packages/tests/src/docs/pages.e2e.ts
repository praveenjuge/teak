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

test("public docs describe expanded file support and inferred uploads", async ({
  page,
}) => {
  await page.goto("/docs/api/");
  await expect(page.locator("body")).toContainText("100 MB");
  await expect(page.locator("body")).toContainText(/cardType.*optional/i);

  await page.goto("/docs/cli/");
  await expect(page.locator("body")).toContainText(/Markdown and MDX/i);

  await page.goto("/docs/mcp/");
  await expect(page.locator("body")).toContainText(/cardType.*inferred/i);

  await page.goto("/docs/extension/");
  await expect(page.locator("body")).toContainText("Save Asset to Teak");
});
