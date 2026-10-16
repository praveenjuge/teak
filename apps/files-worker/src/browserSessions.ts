import type {
  ActiveSession,
  Browser,
  WorkersLaunchOptions,
} from "@cloudflare/puppeteer";
import { OpFailure } from "./opFailure";

/** A browser borrowed for one operation; `release` keeps it running. */
export interface BrowserLease {
  browser: Browser;
  release: () => Promise<void>;
}

export type AcquireBrowser = () => Promise<BrowserLease>;

export interface BrowserRunClient<Binding> {
  connect: (binding: Binding, sessionId: string) => Promise<Browser>;
  launch: (
    binding: Binding,
    options?: WorkersLaunchOptions
  ) => Promise<Browser>;
  sessions: (binding: Binding) => Promise<ActiveSession[]>;
}

// An idle browser stays up this long for the next operation, so a link's
// scrape and screenshot, or a batch of imports, share one browser.
export const BROWSER_KEEP_ALIVE_MS = 60_000;
const MAX_CONNECT_ATTEMPTS = 2;

/**
 * Reuse a running Browser Run session when one exists, else launch one that
 * stays alive between operations. New browsers count against the plan's launch
 * rate and concurrency limits; connections to a running one do not. Each
 * operation opens its pages in its own browser context, so they share no
 * cookies or storage. A refused launch throws `browser_unavailable`, which
 * callers answer as RENDERER_UNAVAILABLE so Convex retries later.
 */
export const createBrowserAcquirer =
  <Binding>(
    client: BrowserRunClient<Binding>,
    binding: Binding
  ): AcquireBrowser =>
  async () => {
    const running = await client.sessions(binding).catch(() => []);
    const candidates = [...running]
      .sort(
        (a, b) =>
          Number(Boolean(a.connectionId)) - Number(Boolean(b.connectionId))
      )
      .slice(0, MAX_CONNECT_ATTEMPTS);
    for (const session of candidates) {
      try {
        const browser = await client.connect(binding, session.sessionId);
        return { browser, release: () => browser.disconnect() };
      } catch {}
    }
    try {
      const browser = await client.launch(binding, {
        keep_alive: BROWSER_KEEP_ALIVE_MS,
      });
      return { browser, release: () => browser.disconnect() };
    } catch (error) {
      console.warn("[files-worker] Browser Run unavailable", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new OpFailure("browser_unavailable");
    }
  };
