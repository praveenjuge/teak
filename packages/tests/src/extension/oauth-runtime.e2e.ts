import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { capturePageErrors } from "../helpers/page-hooks";
import { type Browser, expect, test } from "../helpers/test";

declare global {
  interface Window {
    __teakClock: { setSystemTime: (time: number) => void };
    auth: {
      beginOAuthSignIn: () => Promise<void>;
      signOutOAuth: () => Promise<string | undefined>;
      getCaptureOwner: () => Promise<string | undefined>;
      getOAuthState: () => Promise<{
        authenticated: boolean;
        user?: { id: string };
      }>;
    };
    authorizeUrl: string;
  }
}
const origin = "https://extension-runtime.test";
const site = "https://fixture.convex.site";
const owner = "permanent-teak-owner";
const surfaces = ["cli", "raycast", "chrome", "firefox"];
const extensionModule = (name: string) =>
  fileURLToPath(
    new URL(`../../../../apps/extension/lib/${name}.ts`, import.meta.url)
  );
const moduleEntry = `export * from ${JSON.stringify(extensionModule("oauthAuth"))};
export { getCaptureOwner } from ${JSON.stringify(extensionModule("captureOwner"))};
`;

/**
 * Starts the page's clock at `time` and lets it run, like Playwright's
 * `clock.install({ time })`. The module and the SDK read time only through
 * `Date.now`, so that is the clock this controls. The offset lives in
 * sessionStorage so time keeps flowing across reloads, as it does under
 * Playwright's clock.
 */
const installClock = (browser: Browser, time: number) =>
  browser.addInitScript((start: number) => {
    const key = "__teakClockOffset";
    const realNow = Date.now.bind(Date);
    let offset = start - realNow();
    try {
      const saved = sessionStorage.getItem(key);
      if (saved === null) {
        sessionStorage.setItem(key, String(offset));
      } else {
        offset = Number(saved);
      }
    } catch {
      /* about:blank and opaque origins have no sessionStorage. */
    }
    Date.now = () => realNow() + offset;
    Object.assign(window, {
      __teakClock: {
        setSystemTime: (next: number) => {
          offset = next - realNow();
          sessionStorage.setItem(key, String(offset));
        },
      },
    });
  }, time);

/** Moves the clock without firing timers, like `clock.setSystemTime`. */
const setSystemTime = (browser: Browser, time: number) =>
  browser.evaluate((next: number) => {
    window.__teakClock.setSystemTime(next);
    return null;
  }, time);

const waitForAuth = (browser: Browser) =>
  expect.poll(() => browser.evaluate(() => Boolean(window.auth))).toBe(true);

/** `getCaptureOwner`, keeping `undefined` apart from a value across JSON. */
const captureOwner = (browser: Browser) =>
  browser.evaluate(async () => {
    const value = await window.auth.getCaptureOwner();
    return value === undefined
      ? { defined: false, value: null }
      : { defined: true, value };
  });

for (const mode of ["production", "development"] as const) {
  test(`${mode} workos login survives a module reload, rotates once, and revokes on logout`, async ({
    browser,
  }) => {
    const isDevelopment = mode === "development";
    const discoveryOrigin = isDevelopment ? site : "https://teakvault.com";
    const surface = "chrome";
    const issuer = "https://fixture.workos.test";
    const clientId = `client_${surface}`;
    const authorize = `${issuer}/authorize`;
    const tokenEndpoint = `${issuer}/token`;
    const initialAccess = crypto.randomUUID();
    const initialRefresh = crypto.randomUUID();
    const rotatedAccess = crypto.randomUUID();
    const rotatedRefresh = crypto.randomUUID();
    const outputDir = mkdtempSync(join(tmpdir(), "teak-oauth-runtime-"));
    const bundle = join(outputDir, "auth.mjs");
    const moduleSource = join(outputDir, "entry.ts");
    writeFileSync(moduleSource, moduleEntry);
    let source: string;
    try {
      execFileSync(
        "bun",
        [
          "--no-env-file",
          "build",
          moduleSource,
          "--target=browser",
          "--format=esm",
          "--define",
          `import.meta.env=${JSON.stringify({ BROWSER: surface, DEV: isDevelopment, VITE_PUBLIC_CONVEX_SITE_URL: site })}`,
          "--outfile",
          bundle,
        ],
        { stdio: "pipe" }
      );
      source = readFileSync(bundle, "utf8");
    } finally {
      rmSync(outputDir, { force: true, recursive: true });
    }
    const exchanges: URLSearchParams[] = [];
    const revoked: string[] = [];
    await browser.route("**/*", async (route) => {
      const { request } = route;
      const url = request.url;
      const json = (body: unknown) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(body),
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      if (request.method === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST",
          },
        });
      } else if (url === `${origin}/`) {
        await route.fulfill({
          contentType: "text/html",
          body: '<script type="module">import * as auth from "/auth.mjs"; window.auth = auth;</script>',
        });
      } else if (url === `${origin}/auth.mjs`) {
        await route.fulfill({ contentType: "text/javascript", body: source });
      } else if (
        url === `${discoveryOrigin}/.well-known/oauth-protected-resource/mcp`
      ) {
        await json({
          resource: "https://teakvault.com/mcp",
          authorization_servers: [issuer],
        });
      } else if (
        url === `${discoveryOrigin}/.well-known/teak-oauth-clients.json`
      ) {
        await json({
          primary: "workos",
          issuer,
          clients: Object.fromEntries(
            surfaces.map((name) => [name, `client_${name}`])
          ),
        });
      } else if (url === `${issuer}/.well-known/oauth-authorization-server`) {
        await json({
          issuer,
          authorization_endpoint: authorize,
          token_endpoint: tokenEndpoint,
          code_challenge_methods_supported: ["S256"],
        });
      } else if (url === tokenEndpoint) {
        const body = new URLSearchParams(request.postData ?? "");
        exchanges.push(body);
        expect(body.get("client_id")).toBe(clientId);
        expect(body.get("resource")).toBe("https://teakvault.com/api");
        const rotated = exchanges.length > 1;
        if (rotated) {
          expect(body.get("refresh_token")).toBe(initialRefresh);
        }
        await json({
          access_token: rotated ? rotatedAccess : initialAccess,
          refresh_token: rotated ? rotatedRefresh : initialRefresh,
          expires_in: rotated ? 3600 : 60,
        });
      } else if (url === `${site}/v1/me`) {
        expect(request.headers.authorization).toBe(
          `Bearer ${exchanges.length > 1 ? rotatedAccess : initialAccess}`
        );
        await json({
          data: {
            id: owner,
            email: "owner@example.test",
            name: "Fixture owner",
          },
        });
      } else if (url === `${site}/v1/oauth/disconnect`) {
        expect(request.headers.authorization).toBe(`Bearer ${rotatedAccess}`);
        expect(request.postData ?? null).toBeNull();
        revoked.push(rotatedAccess);
        await route.fulfill({
          status: 204,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } else {
        throw new Error(`Unexpected fixture request: ${url}`);
      }
    });
    // Registered after the catch-all, so its route runs first (routes run
    // newest first) and answers the page-error hook itself.
    const pageErrors = await capturePageErrors(browser);
    await browser.addInitScript(() => {
      const read = () =>
        JSON.parse(localStorage.getItem("chrome-storage-boundary") ?? "{}");
      const write = (values: Record<string, unknown>) =>
        localStorage.setItem("chrome-storage-boundary", JSON.stringify(values));
      Object.assign(globalThis, {
        chrome: {
          identity: {
            getRedirectURL: (path: string) =>
              `https://fixture.chromiumapp.org/${path}`,
            launchWebAuthFlow: ({ url }: { url: string }) => {
              Object.assign(window, { authorizeUrl: url });
              const input = new URL(url);
              const callback = new URL(input.searchParams.get("redirect_uri")!);
              callback.searchParams.set(
                "state",
                input.searchParams.get("state")!
              );
              callback.searchParams.set("code", "fixture-authorization-code");
              return Promise.resolve(callback.href);
            },
          },
          storage: {
            local: {
              setAccessLevel: async () => undefined,
              get: async (key: string) => ({ [key]: read()[key] }),
              set: async (values: Record<string, unknown>) =>
                write({ ...read(), ...values }),
              remove: (keys: string | string[]) => {
                const values = read();
                for (const key of [keys].flat()) {
                  delete values[key];
                }
                write(values);
                return Promise.resolve();
              },
            },
          },
        },
      });
    });
    const start = new Date("2026-10-04T00:00:00Z").getTime();
    await installClock(browser, start);
    await browser.goto(origin);
    await waitForAuth(browser);
    await browser.evaluate(async () => {
      await window.auth.beginOAuthSignIn();
      return null;
    });
    const authUrl = new URL(await browser.evaluate(() => window.authorizeUrl));
    expect(authUrl.origin).toBe(issuer);
    expect(authUrl.searchParams.get("client_id")).toBe(clientId);
    expect(authUrl.searchParams.get("resource")).toBe(
      "https://teakvault.com/api"
    );
    expect(authUrl.searchParams.get("scope")).toBe(
      "openid profile email offline_access"
    );
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await captureOwner(browser)).toEqual({
      defined: true,
      value: owner,
    });
    await browser.reload();
    await waitForAuth(browser);
    await setSystemTime(browser, start + 40_000);
    const states = await browser.evaluate(async () =>
      JSON.parse(
        JSON.stringify(
          await Promise.all([1, 2, 3].map(() => window.auth.getOAuthState()))
        )
      )
    );
    expect(states).toHaveLength(3);
    for (const state of states) {
      expect(state).toMatchObject({
        authenticated: true,
        user: { id: owner },
      });
    }
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].get("grant_type")).toBe("refresh_token");
    await browser.evaluate(async () => {
      await window.auth.signOutOAuth();
      return null;
    });
    expect(revoked).toEqual([rotatedAccess]);
    await browser.reload();
    await waitForAuth(browser);
    expect(
      await browser.evaluate(async () =>
        JSON.parse(JSON.stringify(await window.auth.getOAuthState()))
      )
    ).toMatchObject({ authenticated: false });
    expect(await captureOwner(browser)).toEqual({
      defined: false,
      value: null,
    });
    expect(pageErrors.errors).toEqual([]);
  });
}
