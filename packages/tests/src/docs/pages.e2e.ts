import { expect, test } from "@playwright/test";

for (const path of [
  "/docs/",
  "/docs/api/",
  "/docs/mcp/",
  "/docs/cli/",
  "/reference/",
]) {
  test(`docs key page ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).toContainText(
      /Teak|API|MCP|CLI|Reference|Health/
    );
  });
}

test("docs Orama search index is published", async ({ page }) => {
  const response = await page.request.get("/blume-search.json");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload).toBeTruthy();
});

test("docs llms.txt is published", async ({ page }) => {
  const response = await page.request.get("/llms.txt");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("Teak");
  expect(body).toContain("/docs/api");
});

test("changelog renders Blume release notes", async ({ page }) => {
  await page.goto("/changelog/");

  const releaseNotes = page.locator("[data-blume-update]").first();
  await expect(releaseNotes).toBeVisible();
  const releaseLink = releaseNotes.getByRole("link").first();
  await expect(releaseLink).toHaveText(/^[A-Z][a-z]+ 20\d{2}$/);
  await expect(releaseLink).toHaveAttribute(
    "href",
    /^\/changelog\/[a-z]+-20\d{2}$/
  );
  await expect(releaseNotes.locator("li")).not.toHaveCount(0);
});

test("public docs describe expanded file support and optional card types", async ({
  page,
}) => {
  await page.goto("/docs/api/");
  await expect(page.locator("body")).toContainText("100 MB");
  await expect(page.locator("body")).toContainText(/cardType.*optional/i);

  await page.goto("/docs/cli/");
  await expect(page.locator("body")).toContainText(/Markdown and MDX/i);

  await page.goto("/docs/mcp/");
  await expect(page.locator("body")).toContainText(
    /cardType.*text.*stores raw Markdown exactly/i
  );
  await expect(page.locator("body")).toContainText(
    /automatic URL, quote, and palette detection remains when the type is omitted/i
  );

  await page.goto("/docs/extension/");
  await expect(page.locator("body")).toContainText("Save Asset to Teak");
});
