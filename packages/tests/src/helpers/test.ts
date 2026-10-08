import { test as base } from "@playwright/test";
import { signIn } from "./app";
import { E2E_PASSWORD } from "./env";
import { type AccountKey, requireAccount } from "./run-state";

export { expect } from "@playwright/test";

export interface JourneyOptions {
  /** The setup account this project's tests sign in as. */
  account: AccountKey | undefined;
}

// Each test signs in through the hosted login page instead of reusing a
// saved cookie: the web client refreshes its session on its own schedule and
// WorkOS may rotate the refresh token (the emulator always does), which
// leaves any earlier copy of the cookie dead.
export const test = base.extend<JourneyOptions & { signedIn: undefined }>({
  account: [undefined, { option: true }],
  signedIn: [
    async ({ account, page }, use) => {
      if (account) {
        const { email, password } = requireAccount(account);
        await signIn(page, email, password ?? E2E_PASSWORD);
      }
      await use(undefined);
    },
    { auto: true },
  ],
});
