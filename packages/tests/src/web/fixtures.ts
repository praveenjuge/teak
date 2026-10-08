import { test as base } from "@playwright/test";
import { signIn } from "../helpers/app";
import { createEmulatorUser, sessionTokenFor } from "../helpers/emulator";
import { E2E_PASSWORD, env, uniqueEmail } from "../helpers/env";
import { EditorLibrary } from "./editor-library";

export { expect } from "@playwright/test";

// Web surface specs: each test signs up its own WorkOS account, so tests
// never share state or per-user rate limits (six content edits a minute).
export const test = base.extend<{
  library: EditorLibrary;
  webAccount: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  webAccount: async ({}, use) => {
    const email = uniqueEmail("web");
    await createEmulatorUser({
      email,
      emailVerified: true,
      password: E2E_PASSWORD,
    });
    await use(email);
  },
  page: async ({ page, webAccount }, use) => {
    await signIn(page, webAccount);
    await use(page);
  },
  library: async ({ page, webAccount }, use) => {
    const library = new EditorLibrary(
      page,
      env.convexUrl,
      await sessionTokenFor(webAccount, E2E_PASSWORD)
    );
    await use(library);
    await library.cleanup();
  },
});

// The browser's sync socket to the local Convex backend.
export const convexSocket = `${env.convexUrl.replace(/^http/, "ws")}/**`;

export const generateTestContent = (prefix = "Test") =>
  `${prefix} content ${Date.now()}`;
