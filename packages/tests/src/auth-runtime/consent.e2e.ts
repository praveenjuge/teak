import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { AuthDiscovery } from "@teak/convex/sdk";
import { WORKOS_RESOURCES } from "@teak/convex/shared/workosResources";
import { env } from "../helpers/env";
import { verifyWorkosConsentJourney } from "../helpers/workos-consent";

const issuer = "https://consent-provider.test";
const provider = {
  primary: "workos",
  issuer,
  authorizationEndpoint: `${issuer}/authorize`,
  tokenEndpoint: `${issuer}/token`,
} as AuthDiscovery;
interface Registration {
  challenge?: string;
  consent: string;
  name: string;
  redirect: string;
  resource?: string;
}
// Owned helpers and real MCP transport run unchanged; only external HTTP and
// rendered provider/settings HTML are fixtures. This is not hosted auth proof.
for (const failure of [
  "none",
  "revocation-ignored",
  "sibling-revoked",
  "wrong-owner",
  "wrong-audience",
  "pkce-mismatch",
] as const) {
  test(
    failure === "none"
      ? "consent journey preserves ownership, audiences, and per-consent revocation after refresh"
      : `consent journey rejects ${failure}`,
    async ({ page }, testInfo) => {
      const registrations = new Map<string, Registration>();
      const revoked = new Set<string>();
      const observations: {
        path: string;
        resource?: string;
        status?: number;
      }[] = [];
      const originalFetch = globalThis.fetch;
      let nextClient = 0;
      let cardContent: string | undefined;
      const expectedApiKey = "fixture-browser-owner-key";
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      const grant = (id: string, registered: Registration) => ({
        access_token: `fixture.${Buffer.from(JSON.stringify({ iss: issuer, aud: failure === "wrong-audience" ? "https://wrong-resource.test" : registered.resource, sub: "user_fixture", sid: registered.consent })).toString("base64url")}.signature`,
        refresh_token: `${id}:refresh:${observations.length}`,
      });
      globalThis.fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1]
        ) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          const observation: {
            path: string;
            resource?: string;
            status?: number;
          } = {
            path: url.pathname,
          };
          observations.push(observation);
          if (url.href === `${issuer}/.well-known/oauth-authorization-server`) {
            return json({
              issuer,
              authorization_endpoint: provider.authorizationEndpoint,
              token_endpoint: provider.tokenEndpoint,
              registration_endpoint: `${issuer}/register`,
            });
          }
          if (url.href === `${issuer}/register`) {
            const body = await request.json();
            expect(body.token_endpoint_auth_method).toBe("none");
            expect(body.grant_types).toEqual([
              "authorization_code",
              "refresh_token",
            ]);
            const id = `client_fixture${++nextClient}`;
            registrations.set(id, {
              name: body.client_name,
              redirect: body.redirect_uris[0],
              consent: `app_consent_fixture${nextClient}`,
            });
            return json({ client_id: id });
          }
          if (url.href === provider.tokenEndpoint) {
            const form = new URLSearchParams(await request.text());
            const id = form.get("client_id") ?? "";
            const registered = registrations.get(id);
            if (!registered) {
              throw new Error("Unknown token client");
            }
            expect(form.get("resource")).toBe(registered.resource);
            if (form.get("grant_type") === "authorization_code") {
              expect(form.get("code")).toBe(id);
              expect(form.get("redirect_uri")).toBe(registered.redirect);
              expect(
                createHash("sha256")
                  .update(form.get("code_verifier") ?? "")
                  .digest("base64url")
              ).toBe(registered.challenge);
            } else {
              expect(form.get("grant_type")).toBe("refresh_token");
              expect(
                form.get("refresh_token")?.startsWith(`${id}:refresh:`)
              ).toBe(true);
            }
            observation.resource = registered.resource;
            return json(grant(id, registered));
          }
          if (
            url.href === `${env.apiUrl}/v1/cards` &&
            request.headers.get("Authorization") === `Bearer ${expectedApiKey}`
          ) {
            expect(request.method).toBe("POST");
            cardContent = (await request.json()).content;
            return json({ cardId: "fixture-card" });
          }
          if (
            url.href === `${env.apiUrl}/v1/cards/fixture-card` &&
            request.headers.get("Authorization") === `Bearer ${expectedApiKey}`
          ) {
            expect(request.method).toBe("DELETE");
            cardContent = undefined;
            return json({ success: true });
          }
          if (
            url.href === `${env.apiUrl}/v1/tags` ||
            url.href === `${env.apiUrl}/v1/cards/fixture-card` ||
            url.href === env.mcpUrl
          ) {
            const bearer =
              request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              "";
            const claims = JSON.parse(
              Buffer.from(bearer.split(".")[1], "base64url").toString()
            );
            const resource =
              url.href === env.mcpUrl
                ? WORKOS_RESOURCES.mcp
                : WORKOS_RESOURCES.api;
            const allowed =
              claims.aud === resource &&
              (failure === "revocation-ignored" || !revoked.has(claims.sid));
            observation.status = allowed ? 200 : 401;
            observation.resource = claims.aud;
            if (!allowed) {
              return json({ error: "unauthorized" }, 401);
            }
            if (url.href !== env.mcpUrl) {
              return json(
                url.pathname.endsWith("/fixture-card")
                  ? {
                      content:
                        failure === "wrong-owner"
                          ? "different-vault"
                          : cardContent,
                    }
                  : { tags: [] }
              );
            }
            if (request.method === "GET") {
              return new Response(null, { status: 405 });
            }
            if (request.method === "DELETE") {
              return new Response(null, { status: 200 });
            }
            const message = await request.json();
            if (!("id" in message)) {
              return new Response(null, { status: 202 });
            }
            let result: unknown;
            if (message.method === "initialize") {
              result = {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: "boundary", version: "1" },
              };
            } else if (message.method === "tools/call") {
              expect(message.params.name).toBe("teak_v1_get_card");
              expect(message.params.arguments.cardId).toBe("fixture-card");
              result = {
                content: [{ type: "text", text: cardContent }],
                structuredContent: { content: cardContent },
              };
            } else {
              expect(message.method).toBe("tools/list");
              result = {
                tools: [
                  {
                    name: "list_cards",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              };
            }
            return json({ jsonrpc: "2.0", id: message.id, result });
          }
          throw new Error(`Unexpected external request ${url.href}`);
        },
        { preconnect: originalFetch.preconnect }
      );
      try {
        await page.route(`${issuer}/authorize?*`, async (route) => {
          const params = new URL(route.request().url()).searchParams;
          const id = params.get("client_id") ?? "";
          const registered = registrations.get(id);
          if (!registered) {
            throw new Error("Unknown authorization client");
          }
          expect(params.get("code_challenge_method")).toBe("S256");
          expect(params.get("scope")).toBe(
            "openid profile email offline_access"
          );
          expect(params.get("redirect_uri")).toBe(registered.redirect);
          registered.challenge =
            failure === "pkce-mismatch"
              ? "different-challenge"
              : (params.get("code_challenge") ?? "");
          registered.resource = params.get("resource") ?? "";
          const callback = new URL(registered.redirect);
          callback.search = new URLSearchParams({
            code: id,
            state: params.get("state") ?? "",
          }).toString();
          await route.fulfill({
            contentType: "text/html",
            body: `<p>${registered.name} would like access to your account</p><p>Confirmation of your identity</p><p>Your email address</p><a role="button" href="${callback.href}">Allow access</a>`,
          });
        });
        await page.route(`${env.appUrl}/settings`, async (route) => {
          const rows = [...registrations.values()]
            .map(
              (r) =>
                `<div data-testid="connection-${r.consent}"><button onclick="disconnect(this,'${r.consent}')">Disconnect</button></div>`
            )
            .join("");
          await route.fulfill({
            contentType: "text/html",
            body: `<div><span>Security</span><button onclick="document.querySelector('[role=dialog]').hidden=false">Manage</button></div><div role="dialog" aria-label="Security" hidden><button role="tab">Connections</button>${rows}</div><script>async function disconnect(button,id){await fetch('/fixture/disconnect/'+id,{method:'POST'});button.parentElement.remove()}</script>`,
          });
        });
        await page.route(
          `${env.appUrl}/fixture/disconnect/*`,
          async (route) => {
            revoked.add(
              new URL(route.request().url()).pathname.split("/").at(-1)!
            );
            if (failure === "sibling-revoked") {
              for (const registration of registrations.values()) {
                revoked.add(registration.consent);
              }
            }
            await route.fulfill({ status: 204 });
          }
        );
        const journey = verifyWorkosConsentJourney(
          page,
          provider,
          expectedApiKey
        );
        if (failure !== "none") {
          await expect(journey).rejects.toThrow(
            failure === "sibling-revoked"
              ? /401|unauthorized/i
              : /expect|Expected/
          );
          expect(cardContent).toBeUndefined();
          return;
        }
        await journey;
        expect(cardContent).toBeUndefined();
        expect(registrations.size).toBe(2);
        expect(revoked.size).toBe(2);
        expect(observations.filter((r) => r.path === "/token")).toHaveLength(4);
        expect(observations.filter((r) => r.status === 401)).toHaveLength(6);
        await testInfo.attach("consent-network-proof", {
          body: JSON.stringify(observations, null, 2),
          contentType: "application/json",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
}
