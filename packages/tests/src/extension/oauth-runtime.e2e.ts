import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    auth: {
      beginOAuthSignIn: () => Promise<void>;
      signOutOAuth: () => Promise<void>;
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
const surfaces = ["cli", "raycast", "chrome", "firefox", "safari"];

for (const mode of ["production", "development"] as const) {
  for (const primary of ["betterauth", "workos"] as const) {
    test(`${mode} ${primary} login survives a module reload, rotates once, and revokes on logout`, async ({
      page,
      context,
      browserName,
    }, testInfo) => {
      const isDevelopment = mode === "development";
      const discoveryOrigin = isDevelopment ? site : "https://teakvault.com";
      const surface = browserName === "firefox" ? "firefox" : "chrome";
      const legacyIssuer = isDevelopment
        ? "http://localhost:3000"
        : "https://app.teakvault.com";
      const issuer =
        primary === "workos" ? "https://fixture.workos.test" : legacyIssuer;
      const clientId =
        primary === "workos" ? `client_${surface}` : `teak-${surface}`;
      const authorize = `${issuer}/authorize`;
      const tokenEndpoint = `${issuer}/token`;
      const initialAccess = crypto.randomUUID();
      const initialRefresh = crypto.randomUUID();
      const rotatedAccess = crypto.randomUUID();
      const rotatedRefresh = crypto.randomUUID();
      const revoke = `${site}/revoke`;
      const bundle = testInfo.outputPath("auth.mjs");
      // Compile the canonical module; only browser APIs and HTTP are boundaries.
      execFileSync(
        "bun",
        [
          "--no-env-file",
          "build",
          resolve("../../apps/extension/lib/oauthAuth.ts"),
          "--target=browser",
          "--format=esm",
          "--define",
          `import.meta.env=${JSON.stringify({ BROWSER: surface, DEV: isDevelopment, VITE_PUBLIC_CONVEX_SITE_URL: site })}`,
          "--outfile",
          bundle,
        ],
        { stdio: "pipe" }
      );
      const source = readFileSync(bundle, "utf8");
      const exchanges: URLSearchParams[] = [];
      const revoked: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = request.url();
        const json = (body: unknown) =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(body),
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        if (request.method() === "OPTIONS") {
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
            resource:
              primary === "workos"
                ? "https://teakvault.com/mcp"
                : `${discoveryOrigin}/mcp`,
            authorization_servers: [issuer],
          });
        } else if (
          url === `${discoveryOrigin}/.well-known/teak-oauth-clients.json`
        ) {
          await json({
            primary,
            issuer,
            clients: Object.fromEntries(
              surfaces.map((name) => [
                name,
                primary === "workos" ? `client_${name}` : `teak-${name}`,
              ])
            ),
          });
        } else if (url === `${issuer}/.well-known/oauth-authorization-server`) {
          await json({
            issuer,
            authorization_endpoint: authorize,
            token_endpoint: tokenEndpoint,
            revocation_endpoint: revoke,
            code_challenge_methods_supported: ["S256"],
          });
        } else if (url === tokenEndpoint) {
          const body = new URLSearchParams(request.postData() ?? "");
          exchanges.push(body);
          expect(body.get("client_id")).toBe(clientId);
          expect(body.get("resource")).toBe(
            primary === "workos" ? "https://teakvault.com/api" : null
          );
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
          expect(request.headers().authorization).toBe(
            `Bearer ${exchanges.length > 1 ? rotatedAccess : initialAccess}`
          );
          await json({
            data: {
              id: owner,
              email: "owner@example.test",
              name: "Fixture owner",
            },
          });
        } else if (url === revoke) {
          const body = new URLSearchParams(request.postData() ?? "");
          expect(body.get("client_id")).toBe(clientId);
          revoked.push(body.get("token") ?? "");
          await route.fulfill({
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*" },
          });
        } else {
          throw new Error(`Unexpected fixture request: ${url}`);
        }
      });
      await page.addInitScript(
        ({ firefox }) => {
          const read = () =>
            JSON.parse(localStorage.getItem("chrome-storage-boundary") ?? "{}");
          const write = (values: Record<string, unknown>) =>
            localStorage.setItem(
              "chrome-storage-boundary",
              JSON.stringify(values)
            );
          Object.assign(globalThis, {
            chrome: {
              identity: {
                getRedirectURL: (path: string) =>
                  `https://${firefox ? "fixture.extensions.allizom.org" : "fixture.chromiumapp.org"}/${path}`,
                launchWebAuthFlow: ({ url }: { url: string }) => {
                  Object.assign(window, { authorizeUrl: url });
                  const input = new URL(url);
                  const callback = new URL(
                    input.searchParams.get("redirect_uri")!
                  );
                  callback.searchParams.set(
                    "state",
                    input.searchParams.get("state")!
                  );
                  callback.searchParams.set(
                    "code",
                    "fixture-authorization-code"
                  );
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
        },
        { firefox: surface === "firefox" }
      );
      const start = new Date("2026-10-04T00:00:00Z");
      await page.clock.install({ time: start });
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.auth));
      await page.evaluate(() => window.auth.beginOAuthSignIn());
      const authUrl = new URL(await page.evaluate(() => window.authorizeUrl));
      expect(authUrl.origin).toBe(issuer);
      expect(authUrl.searchParams.get("client_id")).toBe(clientId);
      expect(authUrl.searchParams.get("resource")).toBe(
        primary === "workos" ? "https://teakvault.com/api" : null
      );
      expect(authUrl.searchParams.get("scope")).toBe(
        primary === "workos"
          ? "openid profile email offline_access"
          : "profile email offline_access"
      );
      expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(await page.evaluate(() => window.auth.getCaptureOwner())).toBe(
        owner
      );
      if (surface === "firefox") {
        // Real Firefox IndexedDB, not a fake IDB implementation. storage.local carries display state only.
        const displayed = await page.evaluate(() =>
          localStorage.getItem("chrome-storage-boundary")
        );
        expect(displayed).not.toContain(initialAccess);
        expect(displayed).not.toContain(initialRefresh);
      }
      // Destroy the module instance while retaining native browser storage.
      await page.reload();
      await page.waitForFunction(() => Boolean(window.auth));
      await page.clock.setSystemTime(new Date(start.getTime() + 40_000));
      const states = await page.evaluate(() =>
        Promise.all([1, 2, 3].map(() => window.auth.getOAuthState()))
      );
      for (const state of states) {
        expect(state).toMatchObject({
          authenticated: true,
          user: { id: owner },
        });
      }
      expect(exchanges).toHaveLength(2);
      expect(exchanges[1].get("grant_type")).toBe("refresh_token");
      await page.evaluate(() => window.auth.signOutOAuth());
      expect(revoked).toEqual([rotatedRefresh]);
      await page.reload();
      await page.waitForFunction(() => Boolean(window.auth));
      expect(
        await page.evaluate(() => window.auth.getOAuthState())
      ).toMatchObject({ authenticated: false });
      expect(
        await page.evaluate(() => window.auth.getCaptureOwner())
      ).toBeUndefined();
      expect(errors).toEqual([]);
      await testInfo.attach("oauth-runtime-proof", {
        body: JSON.stringify({
          browserName,
          primary,
          permanentOwnerVerified: true,
          reloadVerified: true,
          exchanges: exchanges.length,
          revocations: revoked.length,
          storage:
            surface === "firefox"
              ? "native IndexedDB"
              : "controlled Chrome storage boundary",
        }),
        contentType: "application/json",
      });
    });
  }
}
