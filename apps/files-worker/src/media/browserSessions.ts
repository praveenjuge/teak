import type {
  ActiveSession,
  Browser,
  WorkersLaunchOptions,
} from "@cloudflare/puppeteer";
import { OpFailure } from "../opFailure";

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

export const BROWSER_KEEP_ALIVE_MS = 60_000;
const MAX_CONNECT_ATTEMPTS = 2;

/**
 * New browsers count against the plan's launch rate and concurrency limits;
 * connections to a running one do not.
 */
export const createBrowserAcquirer =
  <Binding>(
    client: BrowserRunClient<Binding>,
    binding: Binding
  ): AcquireBrowser =>
  async () => {
    const connectOrNull = async (sessionId: string) => {
      try {
        return await client.connect(binding, sessionId);
      } catch {
        return null;
      }
    };
    const running = await client.sessions(binding).catch(() => []);
    const candidates = [...running]
      .sort(
        (a, b) =>
          Number(Boolean(a.connectionId)) - Number(Boolean(b.connectionId))
      )
      .slice(0, MAX_CONNECT_ATTEMPTS);
    for (const session of candidates) {
      const browser = await connectOrNull(session.sessionId);
      if (browser) {
        return { browser, release: () => browser.disconnect() };
      }
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
