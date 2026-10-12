import { signIn } from "../helpers/app";
import { createEmulatorUser, sessionTokenFor } from "../helpers/emulator";
import { E2E_PASSWORD, env, uniqueEmail } from "../helpers/env";
import { test as base } from "../helpers/test";
import { EditorLibrary } from "./editor-library";

export { expect } from "../helpers/test";

// Web surface specs: each test signs up its own WorkOS account and starts
// signed in, so tests never share state or per-user rate limits (six content
// edits a minute).
export const test = base
  .extend<{ webAccount: string }>({
    webAccount: async ({ browser, screen }, use) => {
      const email = uniqueEmail("web");
      await createEmulatorUser({
        email,
        emailVerified: true,
        password: E2E_PASSWORD,
      });
      await signIn({ browser, screen }, email);
      await use(email);
    },
  })
  .extend<{ library: EditorLibrary }>({
    library: async ({ browser, screen, webAccount }, use) => {
      const library = new EditorLibrary(
        { browser, screen },
        env.convexUrl,
        await sessionTokenFor(webAccount, E2E_PASSWORD)
      );
      await use(library);
      await library.cleanup();
    },
  });

export const generateTestContent = (prefix = "Test") =>
  `${prefix} content ${Date.now()}`;
