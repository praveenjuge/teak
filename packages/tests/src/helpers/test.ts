import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

// The web client refreshes its session on load, and WorkOS may rotate the
// refresh token (the emulator always does), which leaves an earlier copy of
// the cookie dead. Tests in a project share one account and run one at a
// time, so each test hands its latest session to the next.
export const test = base.extend<{ persistSession: undefined }>({
  persistSession: [
    async ({ context }, use, testInfo) => {
      await use(undefined);
      const path = testInfo.project.use.storageState;
      if (typeof path === "string") {
        await context.storageState({ path });
      }
    },
    { auto: true },
  ],
});
