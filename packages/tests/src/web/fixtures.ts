import { signUp } from "../helpers/app";
import { sessionTokenFor } from "../helpers/emulator";
import { E2E_PASSWORD, env } from "../helpers/env";
import { test as base } from "../helpers/test";
import { EditorLibrary } from "./editor-library";

export { expect } from "../helpers/test";

export const test = base
  .extend<{ webAccount: string }>({
    webAccount: async ({ browser, screen }, use) => {
      await use(await signUp({ browser, screen }, "web"));
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
