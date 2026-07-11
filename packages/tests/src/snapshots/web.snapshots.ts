import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { assertMailpitReady } from "../helpers/mailpit";
import { signIn, signUp } from "../helpers/prod";
import { rememberAccount } from "../helpers/run-state";

const FIXTURE_TEXT = "Sentry Snapshot Fixture";
const DRAFT_TEXT = "A deterministic note for Teak snapshots";
const SNAPSHOT_ROOT = resolve(import.meta.dirname, "../../.snapshots/current");
const VIEWPORTS = {
  desktop: { height: 1000, width: 1440 },
  "mobile-web": { height: 844, width: 390 },
} as const;
type SnapshotViewportEntry = [
  keyof typeof VIEWPORTS,
  (typeof VIEWPORTS)[keyof typeof VIEWPORTS],
];

const stableCss = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
  [data-sonner-toaster] { display: none !important; }
`;

const capture = async (
  page: Page,
  viewport: keyof typeof VIEWPORTS,
  name: string,
  mask: Locator[] = []
) => {
  await page.addStyleTag({ content: stableCss });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const path = resolve(SNAPSHOT_ROOT, viewport, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    mask,
    path,
  });
};

const settingsRow = (page: Page, label: string) =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=ancestor::div[.//button][1]");

const stabilizeSettingsIdentity = async (page: Page, email: string) => {
  const emailControl = page.getByRole("button", { name: email });
  await expect(emailControl).toBeVisible();
  await emailControl.evaluate((element) => {
    element.textContent = "snapshot@fixtures.invalid";
  });
};

const stabilizeCardModalMetadata = async (page: Page) => {
  const dialog = page.getByRole("dialog");
  const summaryLabel = dialog.getByText("Summary", { exact: true });
  if ((await summaryLabel.count()) === 1) {
    await summaryLabel.locator("xpath=..").evaluate((container) => {
      container.remove();
    });
  }

  const typeBadge = dialog.getByRole("button", { name: "Text", exact: true });
  await expect(typeBadge).toBeVisible();
  await typeBadge.evaluate((button) => {
    for (const sibling of button.parentElement?.querySelectorAll("button") ??
      []) {
      if (sibling !== button) {
        sibling.remove();
      }
    }
  });
};

test("captures the deterministic Teak web product surface", async ({
  browser,
  page,
}) => {
  test.setTimeout(300_000);
  await assertMailpitReady();
  const email = await signUp(page);
  rememberAccount({ email }, true);
  await signIn(page, email);

  await page.goto("/");
  const fixtureComposer = page.getByPlaceholder(/Write a note/i);
  await expect(fixtureComposer).toBeVisible({ timeout: 30_000 });
  await fixtureComposer.fill(FIXTURE_TEXT);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("main").getByText(FIXTURE_TEXT, { exact: true }).first()
  ).toBeVisible({ timeout: 30_000 });

  for (const [viewportName, viewport] of Object.entries(
    VIEWPORTS
  ) as SnapshotViewportEntry[]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

    const anonymousPage = await browser.newPage({ viewport });
    await anonymousPage.emulateMedia({
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    await anonymousPage.goto("/login");
    await expect(anonymousPage.getByLabel("Email")).toBeVisible();
    await capture(anonymousPage, viewportName, "auth");
    await anonymousPage.close();

    await page.goto("/");
    const fixtureCard = page
      .getByRole("main")
      .getByText(FIXTURE_TEXT, { exact: true })
      .first();
    await expect(fixtureCard).toBeVisible({ timeout: 30_000 });
    await capture(page, viewportName, "card-grid");

    await fixtureCard.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await stabilizeCardModalMetadata(page);
    await capture(page, viewportName, "card-modal");
    await page.keyboard.press("Escape");

    const search = page.getByPlaceholder("Search for anything...");
    await search.fill(FIXTURE_TEXT);
    await expect(fixtureCard).toBeVisible();
    await capture(page, viewportName, "search");
    await search.fill("");

    const composer = page.getByPlaceholder(/Write a note/i);
    await composer.fill(DRAFT_TEXT);
    await capture(page, viewportName, "add-card");

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await stabilizeSettingsIdentity(page, email);
    await capture(page, viewportName, "settings");

    await page.getByRole("button", { name: "Upgrade" }).click();
    await expect(
      page.getByRole("dialog").getByText("Upgrade to Pro")
    ).toBeVisible();
    await capture(page, viewportName, "billing");
    await page.keyboard.press("Escape");

    await settingsRow(page, "Import/Export Data")
      .getByRole("button", { name: "Manage" })
      .click();
    const dataDialog = page.getByRole("dialog", { name: "Manage Data" });
    await expect(dataDialog).toBeVisible();
    await capture(page, viewportName, "import");

    await dataDialog.getByRole("tab", { name: "Export" }).click();
    await expect(dataDialog.getByText(/export/i).last()).toBeVisible();
    await capture(page, viewportName, "export");
    await page.keyboard.press("Escape");
  }

  expect(Object.keys(VIEWPORTS)).toHaveLength(2);
});
