import { describe, expect, test } from "bun:test";
import type { ActiveSession, Browser } from "@cloudflare/puppeteer";
import {
  BROWSER_KEEP_ALIVE_MS,
  type BrowserRunClient,
  createBrowserAcquirer,
} from "./browserSessions";

const BINDING = { name: "BROWSER" };

const fakeBrowser = (id: string) => {
  const events: string[] = [];
  const browser = {
    close: () => {
      events.push(`close ${id}`);
      return Promise.resolve();
    },
    disconnect: () => {
      events.push(`disconnect ${id}`);
      return Promise.resolve();
    },
  } as unknown as Browser;
  return { browser, events };
};

const client = ({
  connect = () => Promise.reject(new Error("closed")),
  launch = () => Promise.resolve(fakeBrowser("new").browser),
  sessions = () => Promise.resolve([]),
}: Partial<BrowserRunClient<typeof BINDING>>) => {
  const calls: string[] = [];
  const recorded: BrowserRunClient<typeof BINDING> = {
    connect: (binding, sessionId) => {
      calls.push(`connect ${sessionId}`);
      return connect(binding, sessionId);
    },
    launch: (binding, options) => {
      calls.push(`launch keep_alive=${options?.keep_alive}`);
      return launch(binding, options);
    },
    sessions: (binding) => {
      calls.push("sessions");
      return sessions(binding);
    },
  };
  return { calls, recorded };
};

const session = (sessionId: string, connectionId?: string): ActiveSession => ({
  sessionId,
  startTime: 1,
  ...(connectionId ? { connectionId } : {}),
});

describe("createBrowserAcquirer", () => {
  test("joins a running browser, preferring one nobody is connected to, and leaves it running", async () => {
    const running = fakeBrowser("idle");
    const { calls, recorded } = client({
      connect: (_binding, sessionId) =>
        sessionId === "idle"
          ? Promise.resolve(running.browser)
          : Promise.reject(new Error("unexpected")),
      sessions: () =>
        Promise.resolve([session("busy", "conn-1"), session("idle")]),
    });

    const lease = await createBrowserAcquirer(recorded, BINDING)();
    await lease.release();

    expect(lease.browser).toBe(running.browser);
    expect(calls).toEqual(["sessions", "connect idle"]);
    expect(running.events).toEqual(["disconnect idle"]);
  });

  test("launches a browser that stays alive between operations when none is running", async () => {
    const launched = fakeBrowser("new");
    const { calls, recorded } = client({
      launch: () => Promise.resolve(launched.browser),
    });

    const lease = await createBrowserAcquirer(recorded, BINDING)();
    await lease.release();

    expect(calls).toEqual([
      "sessions",
      `launch keep_alive=${BROWSER_KEEP_ALIVE_MS}`,
    ]);
    expect(launched.events).toEqual(["disconnect new"]);
  });

  test("launches when the running browsers close before it can join them", async () => {
    const { calls, recorded } = client({
      sessions: () =>
        Promise.resolve([session("a"), session("b"), session("c")]),
    });

    await createBrowserAcquirer(recorded, BINDING)();

    expect(calls).toEqual([
      "sessions",
      "connect a",
      "connect b",
      `launch keep_alive=${BROWSER_KEEP_ALIVE_MS}`,
    ]);
  });

  test("launches when listing sessions fails", async () => {
    const { calls, recorded } = client({
      sessions: () => Promise.reject(new Error("Unable to fetch sessions")),
    });

    await createBrowserAcquirer(recorded, BINDING)();

    expect(calls.at(-1)).toBe(`launch keep_alive=${BROWSER_KEEP_ALIVE_MS}`);
  });

  test("declines with browser_unavailable when Browser Run refuses a new browser", async () => {
    const { recorded } = client({
      launch: () =>
        Promise.reject(
          new Error(
            "Unable to create new browser: code: 429: message: Too many"
          )
        ),
    });

    await expect(createBrowserAcquirer(recorded, BINDING)()).rejects.toThrow(
      "browser_unavailable"
    );
  });
});
