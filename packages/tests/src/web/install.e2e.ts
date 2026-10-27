import { api } from "@teak/convex";
import { appPath, gotoApp } from "../helpers/app";
import { E2E_PASSWORD } from "../helpers/env";
import { type Browser, describe } from "../helpers/test";
import type { EditorLibrary } from "./editor-library";
import { expect, test } from "./fixtures";

// A 1×1 PNG, small enough to share inline.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

/** Shares a page and a PNG to Teak, as the system share sheet does. */
const share = (browser: Browser, marker: string) =>
  browser.evaluate(
    ({
      action,
      marker,
      png,
    }: {
      action: string;
      marker: string;
      png: string;
    }) => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = action;
      form.enctype = "multipart/form-data";
      const field = (name: string, value: string) => {
        const input = document.createElement("input");
        input.name = name;
        input.value = value;
        form.append(input);
      };
      field("title", "A shared page");
      field("text", `Notes on ${marker}`);
      field("url", `https://example.com/${marker}`);
      const files = document.createElement("input");
      files.type = "file";
      files.name = "files";
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], `${marker}.png`, { type: "image/png" })
      );
      files.files = transfer.files;
      form.append(files);
      document.body.append(form);
      form.submit();
      return null;
    },
    { action: appPath("/share"), marker, png: PNG_BASE64 }
  );

/** Waits until the share worker controls the page, as it does once installed. */
const workerInPlace = (browser: Browser) =>
  expect
    .poll(
      () => browser.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      { timeout: 30_000 }
    )
    .toBe(true);

/** The composer holds the share's text, and the URL no longer carries it. */
const expectSharedDraft = async (browser: Browser, marker: string) => {
  const composer = browser
    .locator('form[data-card-creation-status="ready"]')
    .getByRole("textbox", "Markdown content", { exact: false });
  await expect(composer).toContainText(`Notes on ${marker}`, {
    timeout: 30_000,
  });
  await expect(composer).toContainText("A shared page");
  await expect(composer).toContainText(`https://example.com/${marker}`);
  await expect
    .poll(() => browser.evaluate(() => window.location.search))
    .toBe("");
};

/**
 * The test shares from a browser tab, not the installed app's window, so the
 * library asks before saving the files a page posted (`useSharedFiles`).
 */
const confirmSharedFiles = (browser: Browser) =>
  browser
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Save the shared file to Teak?" })
    .getByRole("button", "Save")
    .click({ timeout: 60_000 });

/** The shared PNG became an image card. */
const expectUploaded = (library: EditorLibrary, marker: string) =>
  expect
    .poll(
      async () =>
        (await library.client.query(api.cards.getCards, {})).some(
          (card: { fileMetadata?: { fileName?: string } }) =>
            card.fileMetadata?.fileName === `${marker}.png`
        ),
      { timeout: 60_000 }
    )
    .toBe(true);

describe("Installed web app", () => {
  test("the manifest makes the app installable and a share target", async ({
    browser,
    webAccount: _signedIn,
  }) => {
    await gotoApp(browser, "/");
    const manifest = await browser.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const response = await fetch(link?.getAttribute("href") ?? "");
      return response.json();
    });
    expect(manifest).toMatchObject({
      name: "Teak",
      start_url: "/",
      display: "standalone",
      share_target: { action: "/share", method: "POST" },
    });
    const icons = await browser.evaluate(
      async (sources: string[]) =>
        Promise.all(
          sources.map(async (src) =>
            (await fetch(src)).headers.get("content-type")
          )
        ),
      manifest.icons.map((icon: { src: string }) => icon.src)
    );
    expect(icons).toEqual(["image/png", "image/png", "image/png", "image/png"]);
  });

  test("a share fills the composer and uploads its files", {
    timeout: 180_000,
  }, async ({ browser, library }) => {
    await gotoApp(browser, "/");
    await workerInPlace(browser);
    const marker = `shared${Date.now().toString(36)}`;
    await share(browser, marker);

    await expectSharedDraft(browser, marker);
    await confirmSharedFiles(browser);
    await expectUploaded(library, marker);
  });

  test("a share while signed out continues after sign-in", {
    timeout: 180_000,
  }, async ({ browser, library, screen, webAccount }) => {
    await gotoApp(browser, "/settings");
    await workerInPlace(browser);
    await screen.getByRole("button", "Sign out").click();
    await expect(screen.getByLabel("Email")).toBeVisible({ timeout: 30_000 });

    // Shared from outside Teak, the share still goes through Teak's worker,
    // and sign-in keeps it.
    const marker = `signedout${Date.now().toString(36)}`;
    await share(browser, marker);
    await expect(screen.getByLabel("Email")).toBeVisible({ timeout: 30_000 });
    await screen.getByLabel("Email").fill(webAccount);
    await screen.getByRole("button", "Continue").click();
    await screen.getByLabel("Password").fill(E2E_PASSWORD);
    await screen.getByRole("button", "Continue").click();

    await expectSharedDraft(browser, marker);
    await confirmSharedFiles(browser);
    await expectUploaded(library, marker);
  });
});
