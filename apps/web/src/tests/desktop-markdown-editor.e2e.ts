import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  _electron,
  type ElectronApplication,
  expect,
  test,
} from "@playwright/test";
import { api } from "@teak/convex";
import {
  EditorLibrary,
  goToEnd,
  pasteMarkdown,
  getBlockEditor as switchToBlocks,
} from "./editor-library";
import { AuthHelper, generateTestContent } from "./test-helpers";

// Opt-in native journey. Build apps/desktop with the same isolated development
// backend as apps/web before running PLAYWRIGHT_DESKTOP_EDITOR=1.
test("desktop saves Markdown with native shortcuts and reopens the note", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.platform !== "darwin" ||
      process.env.PLAYWRIGHT_DESKTOP_EDITOR !== "1",
    "Opt-in macOS Electron journey"
  );
  if (
    !(
      baseURL &&
      ["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) &&
      process.env.CONVEX_DEPLOYMENT?.startsWith("dev:")
    )
  ) {
    throw new Error("Desktop editor tests require an isolated local stack");
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("Missing development Convex URL");
  }
  const context = await browser.newContext({ baseURL });
  const web = await context.newPage();
  await new AuthHelper(web).signUpWithEmailAndPassword(
    `e2e-desktop-editor-${Date.now()}@example.com`,
    `Editor-${crypto.randomUUID()}!`
  );
  const auth = await (
    await context.request.get("/api/auth/get-session")
  ).json();
  const { token } = await (
    await context.request.get("/api/auth/convex/token")
  ).json();
  if (!(auth.session?.token && token)) {
    throw new Error("Missing test session");
  }
  const library = new EditorLibrary(web, url, token);
  const profile = mkdtempSync(resolve(tmpdir(), "teak-editor-"));
  const entry = resolve(profile, "entry.mjs");
  const main = resolve("../desktop/.vite/build/main.js");
  writeFileSync(
    entry,
    `import { app } from 'electron'; app.setPath('userData', ${JSON.stringify(profile)}); await import(${JSON.stringify(main)});`
  );
  let desktop: ElectronApplication | undefined;
  try {
    desktop = await _electron.launch({
      executablePath: resolve(
        "../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
      ),
      args: [entry],
    });
    expect(await desktop.evaluate(({ app }) => app.getPath("userData"))).toBe(
      profile
    );
    await desktop
      .context()
      .tracing.start({ screenshots: true, snapshots: true });
    const page = await desktop.firstWindow();
    await page.evaluate(async (sessionToken) => {
      const bridge = (
        window as unknown as {
          teakDesktop: {
            store: { write: (key: string, value: string) => Promise<void> };
          };
        }
      ).teakDesktop;
      await bridge.store.write("auth.sessionToken", sessionToken);
    }, auth.session.token);
    const connection = page.waitForEvent("websocket");
    await page.reload();
    expect(new URL((await connection).url()).hostname).toBe(
      new URL(url).hostname
    );
    const composer = page.getByRole("group", {
      name: "Markdown content editor",
    });
    await expect(composer).toBeVisible();
    const marker = generateTestContent("Native editor");
    const source = `# ${marker}\n\n- First\n- Second\n\nLast`;
    await pasteMarkdown(composer, source);
    const blocks = await switchToBlocks(composer);
    await goToEnd(blocks);
    await blocks.pressSequentially(" edited");
    await page.screenshot({ path: testInfo.outputPath("desktop-light.png") });
    await blocks.press("Meta+Enter");
    await expect
      .poll(
        async () =>
          (await library.client.query(api.cards.getCards, {})).find(
            (card: { content?: string }) => card.content?.includes(marker)
          )?.content
      )
      .toBe(`${source} edited`);
    const card = (await library.client.query(api.cards.getCards, {})).find(
      (item: { content?: string }) => item.content?.includes(marker)
    );
    if (!card) {
      throw new Error("Desktop note was not persisted");
    }
    library.ids.push(card._id);
    await page.reload();
    await page.getByText(marker, { exact: false }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: marker })).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Markdown content" })
    ).toContainText("Last edited");
    await page.keyboard.press("Escape");
    await desktop.evaluate(({ Menu, BrowserWindow }) => {
      const settings = Menu.getApplicationMenu()
        ?.items.flatMap((item) => item.submenu?.items ?? [])
        .find((item) => item.label === "Settings...");
      if (!settings) {
        throw new Error("Desktop Settings menu unavailable");
      }
      settings.click(settings, BrowserWindow.getAllWindows()[0], {
        shift: false,
        control: false,
        alt: false,
        meta: false,
        triggeredByAccelerator: false,
      });
    });
    const dark = page.getByRole("button", { name: "Use dark theme" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Back", exact: false }).click();
    await page.getByText(marker, { exact: false }).first().click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: marker })
    ).toBeVisible();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(800, 600)
    );
    await page.screenshot({
      path: testInfo.outputPath("desktop-dark-narrow.png"),
    });
  } finally {
    if (desktop) {
      await desktop
        .context()
        .tracing.stop({ path: testInfo.outputPath("desktop-trace.zip") });
      await desktop.close();
    }
    await library.cleanup();
    const response = await context.request.post("/api/auth/delete-user", {
      data: {},
      headers: { Origin: baseURL },
    });
    expect(response.ok()).toBe(true);
    await context.close();
    execFileSync("/usr/bin/trash", [profile]);
  }
});
