import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

for (const path of [
  "/docs/",
  "/docs/api/",
  "/docs/mcp/",
  "/docs/cli/",
  "/reference/",
]) {
  test(`docs key page ${path}`, async ({ app, browser }) => {
    await app.open(path);
    await expect(browser.locator("h1")).toBeVisible();
    await expect(browser.locator("body")).toContainText(
      /Teak|API|MCP|CLI|Reference|Health/
    );
  });
}

test("docs Orama search index is published", async () => {
  const response = await fetch(`${published.siteUrl}/blume-search.json`);
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toBeTruthy();
});

test("docs llms.txt is published", async () => {
  const response = await fetch(`${published.siteUrl}/llms.txt`);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain("Teak");
  expect(body).toContain("/docs/api");
});

test("changelog renders Blume release notes", async ({
  app,
  browser,
  screen,
}) => {
  await app.open("/changelog/");

  const releaseNotes = browser.locator("[data-blume-update]").first();
  await expect(releaseNotes).toBeVisible();
  const releaseLink = releaseNotes.getByRole("link").first();
  await expect(releaseLink).toHaveText(/\S/);
  await expect(releaseLink).toHaveAttribute(
    "href",
    /^\/changelog\/[a-z0-9-]+\/?$/
  );
  // The list items of the first release note, in one selector since a
  // locator has no nested CSS query.
  await expect(
    browser.locator("[data-blume-update] >> nth=0 >> li")
  ).not.toHaveCount(0);
  const title = await releaseLink.textContent();
  expect(title, "the release link's text").toMatch(/\S/);
  await releaseLink.click();
  await expect(screen.getByRole("heading", title ?? "")).toBeVisible();
});

test("public docs describe expanded file support and optional card types", async ({
  app,
  browser,
}) => {
  const body = browser.locator("body");
  await app.open("/docs/api/");
  await expect(body).toContainText("100 MB");
  await expect(body).toContainText(/cardType.*optional/i);

  await app.open("/docs/cli/");
  await expect(body).toContainText(/Markdown and MDX/i);

  await app.open("/docs/mcp/");
  await expect(body).toContainText(
    /cardType.*text.*stores raw Markdown exactly/i
  );
  await expect(body).toContainText(
    /automatic URL, quote, and palette detection remains when the type is omitted/i
  );

  await app.open("/docs/extension/");
  await expect(body).toContainText("Save Asset to Teak");
});
