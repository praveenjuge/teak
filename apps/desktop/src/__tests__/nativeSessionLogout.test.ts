import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { Transpiler } from "bun";

function fixture(response: Response | Error) {
  const values = new Map<string, unknown>([
    ["auth.sessionToken", "device-token"],
  ]);
  const requests: RequestInit[] = [];
  let cancelled = false;
  const source = readFileSync(
    new URL("../lib/native-auth.ts", import.meta.url),
    "utf8"
  )
    .replace(/^import .*;\n/gm, "")
    .replace(/export /g, "");
  const context = createContext({
    getDesktopConfig: () => ({ convexSiteBaseUrl: "https://auth.test" }),
    fetch: (url: string, options: RequestInit) => {
      expect(url).toBe("https://auth.test/api/auth/sign-out");
      requests.push(options);
      if (response instanceof Error) {
        return Promise.reject(response);
      }
      return Promise.resolve(response);
    },
    window: {
      teakDesktop: {
        store: {
          read: async (key: string) => values.get(key),
          write: (key: string, value: unknown) => {
            values.set(key, value);
            return Promise.resolve();
          },
        },
        oauth: {
          cancel: () => {
            cancelled = true;
            return Promise.resolve();
          },
        },
      },
    },
  });
  runInContext(new Transpiler({ loader: "ts" }).transformSync(source), context);
  return {
    values,
    requests,
    cancelled: () => cancelled,
    logout: () =>
      runInContext("logoutNativeSession()", context) as Promise<void>,
  };
}

describe("desktop device logout", () => {
  test("revokes only the dedicated bearer session before clearing local state", async () => {
    const app = fixture(new Response('{"success":true}'));
    await app.logout();
    expect(app.requests).toEqual([
      {
        method: "POST",
        credentials: "omit",
        headers: {
          Authorization: "Bearer device-token",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    ]);
    expect(app.values.get("auth.sessionToken")).toBeNull();
    expect(app.values.get("auth.pendingNativeFlow")).toBeNull();
    expect(app.cancelled()).toBe(true);
  });
  for (const failure of [
    new Response("", { status: 503 }),
    new Error("offline"),
  ]) {
    test(`preserves credentials for retry on ${failure instanceof Error ? "network failure" : "server failure"}`, async () => {
      const app = fixture(failure);
      await expect(app.logout()).rejects.toThrow();
      expect(app.values.get("auth.sessionToken")).toBe("device-token");
      expect(app.cancelled()).toBe(false);
    });
  }
});
