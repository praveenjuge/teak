import { test as base } from "@playwright/test";
import { createAccount, signIn } from "../helpers/app";
import { sessionTokenFor } from "../helpers/emulator";
import { E2E_PASSWORD, env } from "../helpers/env";
import type { AccountState } from "../helpers/run-state";
import { EditorLibrary } from "./editor-library";

export { expect } from "@playwright/test";

// Web surface specs: each worker owns one WorkOS account, and each test signs
// in through the hosted login page with a fresh session.
export const test = base.extend<
  { library: EditorLibrary },
  { webAccount: AccountState }
>({
  webAccount: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const account = await createAccount(
        await context.newPage(),
        "web"
      ).finally(() => context.close());
      await use(account);
    },
    { scope: "worker" },
  ],
  page: async ({ page, webAccount }, use) => {
    await signIn(page, webAccount.email);
    await use(page);
  },
  library: async ({ page, webAccount }, use) => {
    const library = new EditorLibrary(
      page,
      env.convexUrl,
      await sessionTokenFor(webAccount.email, E2E_PASSWORD)
    );
    await use(library);
    await library.cleanup();
  },
});

// The browser's sync socket to the local Convex backend.
export const convexSocket = `${env.convexUrl.replace(/^http/, "ws")}/**`;

export const generateTestContent = (prefix = "Test") =>
  `${prefix} content ${Date.now()}`;
