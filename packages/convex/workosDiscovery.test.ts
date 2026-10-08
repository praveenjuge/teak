/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { discoverAuthServer } from "./client/authDiscovery";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const workosIssuer = "https://discovery-dev.authkit.app";
const clientIds = {
  cli: "client_CLI",
  raycast: "client_RAYCAST",
  chrome: "client_CHROME",
  firefox: "client_FIREFOX",
  safari: "client_SAFARI",
};
const clientEnv = {
  cli: "WORKOS_CONNECT_CLI_CLIENT_ID",
  raycast: "WORKOS_CONNECT_RAYCAST_CLIENT_ID",
  chrome: "WORKOS_CONNECT_CHROME_CLIENT_ID",
  firefox: "WORKOS_CONNECT_FIREFOX_CLIENT_ID",
  safari: "WORKOS_CONNECT_SAFARI_CLIENT_ID",
} as const;
const resourcePath = "/.well-known/oauth-protected-resource/mcp";
const clientsPath = "/.well-known/teak-oauth-clients.json";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", workosIssuer);
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("TEAK_DEV_APP_URL", "http://localhost:3000");
  vi.stubEnv("PUBLIC_ORIGIN", "http://127.0.0.1:3211");
  for (const [surface, key] of Object.entries(clientEnv)) {
    vi.stubEnv(key, clientIds[surface as keyof typeof clientIds]);
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  return t;
}

function configureTransport(origin: string) {
  const legacyIssuer = origin.startsWith("http:")
    ? "http://localhost:3000"
    : "https://app.teakvault.com";
  vi.stubEnv("PUBLIC_ORIGIN", origin);
  vi.stubEnv("SITE_URL", legacyIssuer);
  return legacyIssuer;
}

function sdkTransport(
  t: ReturnType<typeof setup>,
  origin: string,
  legacyIssuer: string
) {
  const external: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(init).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    if (url.origin === workosIssuer) {
      expect(url.href).toBe(
        `${workosIssuer}/.well-known/oauth-authorization-server`
      );
      external.push(url.href);
      return Response.json({
        issuer: workosIssuer,
        authorization_endpoint: `${workosIssuer}/oauth2/authorize`,
        token_endpoint: `${workosIssuer}/oauth2/token`,
        revocation_endpoint: `${workosIssuer}/oauth2/revoke`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    expect([origin, legacyIssuer]).toContain(url.origin);
    if (
      url.origin === legacyIssuer &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      // The public web issuer proxies this canonical Better Auth backend route.
      return await t.fetch(
        "/api/auth/.well-known/oauth-authorization-server",
        init
      );
    }
    return await t.fetch(`${url.pathname}${url.search}`, init);
  };
  return { transport, external };
}

async function expectUnavailable(t: ReturnType<typeof setup>, path: string) {
  const outcome = await t.fetch(path).then(
    (response) => ({ response }),
    (error: unknown) => ({ error })
  );
  if ("response" in outcome) {
    expect(outcome.response.status).toBeGreaterThanOrEqual(500);
  } else {
    expect(outcome.error).toBeInstanceOf(Error);
  }
}

// Failures: WorkOS uses the local transport as its audience or legacy issuer;
// stale Better Auth client registrations; malformed/incomplete provider config;
// SDK discovery crosses transport/provider boundaries; challenge points at audience.
describe("provider-aware OAuth HTTP discovery", () => {
  test.each(["http://127.0.0.1:3211", "https://teakvault.com"])(
    "WorkOS advertises its registered resource and clients on %s",
    async (origin) => {
      configureTransport(origin);
      const t = setup();
      const resource = await t.fetch(resourcePath);
      expect(resource.status).toBe(200);
      expect(await resource.json()).toMatchObject({
        resource: "https://teakvault.com/mcp",
        authorization_servers: [workosIssuer],
        scopes_supported: ["openid", "profile", "email", "offline_access"],
      });
      const clients = await t.fetch(clientsPath);
      expect(clients.status).toBe(200);
      expect(await clients.json()).toEqual({
        primary: "workos",
        issuer: workosIssuer,
        clients: clientIds,
      });
    }
  );

  for (const origin of ["http://127.0.0.1:3211", "https://teakvault.com"]) {
    test(`SDK discovers WorkOS through the HTTP routes on ${origin}`, async () => {
      const legacyIssuer = configureTransport(origin);
      const t = setup();
      const f = sdkTransport(t, origin, legacyIssuer);
      const auth = await discoverAuthServer(origin, {
        fetch: f.transport,
        ...(origin.startsWith("http:") ? { localIssuer: legacyIssuer } : {}),
      });
      expect(auth).toMatchObject({
        primary: "workos",
        issuer: workosIssuer,
        resource: "https://teakvault.com/mcp",
        clients: clientIds,
        authorizationEndpoint: `${workosIssuer}/oauth2/authorize`,
        tokenEndpoint: `${workosIssuer}/oauth2/token`,
      });
      expect(f.external).toHaveLength(1);
    });
    test(`MCP challenge points at metadata transport on ${origin}`, async () => {
      configureTransport(origin);
      const response = await setup().fetch("/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        `Bearer resource_metadata="${origin}${resourcePath}"`
      );
    });
  }

  test.each([
    undefined,
    "",
    "http://discovery-dev.authkit.app",
    "https://discovery-dev.authkit.app/tenant",
    "https://discovery-dev.authkit.app:8443",
    "https://discovery-dev.authkit.app?tenant=1",
    "https://discovery-dev.authkit.app#fragment",
    "https://user:password@discovery-dev.authkit.app",
    "https://localhost",
    "not-a-url",
  ])(
    "invalid WorkOS issuer %s never advertises legacy discovery",
    async (issuer) => {
      vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", issuer);
      const t = setup();
      await expectUnavailable(t, resourcePath);
      await expectUnavailable(t, clientsPath);
    }
  );

  for (const [surface, key] of Object.entries(clientEnv)) {
    test.each([
      undefined,
      "",
      "teak-cli",
      "client_",
      "client_bad-id",
      "client_bad/id",
    ])(
      `missing or malformed ${surface} client %s denies WorkOS registrations`,
      async (value) => {
        vi.stubEnv(key, value);
        await expectUnavailable(setup(), clientsPath);
      }
    );
  }
});
