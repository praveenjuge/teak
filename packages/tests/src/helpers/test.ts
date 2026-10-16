import type { Browser } from "@e2e-dev/web";
import { expect as e2eExpect, type Locator, type Screen } from "e2e";

export type { Browser } from "@e2e-dev/web";
export { describe, test } from "@e2e-dev/web";
export { expect, type Locator, type Screen } from "e2e";

export interface Surface {
  browser: Browser;
  screen: Screen;
}

const sleep = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Re-runs a block of steps and assertions until it passes or the deadline
 * ends, then throws its last error; the counterpart of Playwright's
 * `expect(fn).toPass()`. Use it only where the whole block must be retried
 * together; a single assertion already waits on its own.
 */
export const retry = async (
  block: () => Promise<void>,
  options: { intervals?: number[]; timeout?: number } = {}
) => {
  const intervals = options.intervals ?? [250, 500, 1000];
  const deadline = Date.now() + (options.timeout ?? 15_000);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await block();
      return;
    } catch (error) {
      const pause = intervals[Math.min(attempt, intervals.length - 1)] ?? 1000;
      if (Date.now() + pause >= deadline) {
        throw error;
      }
      await sleep(pause);
    }
  }
};

export const firstVisible = async (
  locators: readonly Locator[],
  options: { timeout?: number } = {}
): Promise<number> => {
  let found = -1;
  await e2eExpect
    .poll(
      async () => {
        for (const [index, locator] of locators.entries()) {
          // A query that briefly matches twice (a hidden twin) is not visible yet.
          if (await locator.isVisible().catch(() => false)) {
            found = index;
            return true;
          }
        }
        return false;
      },
      { timeout: options.timeout ?? 15_000, interval: 250 }
    )
    .toBe(true);
  return found;
};
