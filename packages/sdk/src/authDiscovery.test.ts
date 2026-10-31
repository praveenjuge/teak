import { describe, expect, test } from "bun:test";
import { discoverAuthServer } from "./index";
import { asFetch } from "./testSupport";

const surfaces = ["cli", "raycast", "chrome", "firefox"] as const;
const clientIds = Object.fromEntries(
  surfaces.map((surface) => [surface, `client_01${surface.toUpperCase()}`])
) as Record<(typeof surfaces)[number], string>;

const teakDocument = (issuer: string): Record<string, unknown> => {
  const { origin } = new URL(issuer);
  return {
    primary: "workos",
    issuer,
    clients: clientIds,
    resource: "https://teakvault.com/mcp",
    authorization_endpoint: `${origin}/oauth2/authorize`,
    token_endpoint: `${origin}/oauth2/token`,
    code_challenge_methods_supported: ["S256"],
  };
};

function fixture(
  issuer = "https://auth.example",
  site = "https://teak.example"
) {
  const document = teakDocument(issuer);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = asFetch((url, init) => {
    const key = String(url);
    calls.push({ url: key, init });
    return Promise.resolve(
      key === `${site}/.well-known/teak-oauth-clients.json`
        ? Response.json(document)
        : new Response("Not found", { status: 404 })
    );
  });
  return { document, calls, transport };
}

describe("OAuth discovery", () => {
  test.each(["https://dev.convex.site", "https://teakvault.com"])(
    "keeps WorkOS resources canonical while discovering from %s",
    async (site: string) => {
      const f = fixture("https://auth.example", site);
      expect(
        await discoverAuthServer(site, { fetch: f.transport })
      ).toMatchObject({
        resource: "https://teakvault.com/mcp",
        issuer: "https://auth.example",
        clients: { cli: "client_01CLI" },
      });
      expect(f.calls.map((call) => call.url)).toEqual([
        `${site}/.well-known/teak-oauth-clients.json`,
      ]);
    }
  );
  test("accepts the deployment's own resource on the discovered origin", async () => {
    const f = fixture();
    f.document.resource = "https://teak.example/mcp";
    expect(
      await discoverAuthServer("https://teak.example/api", {
        fetch: f.transport,
      })
    ).toMatchObject({ resource: "https://teak.example/mcp" });
  });
  test.each([
    "https://other.example/mcp",
    "https://teak.example/api",
    "https://teak.example/mcp/",
    "http://teak.example/mcp",
    "https://teakvault.com/api",
    undefined,
  ])(
    "rejects resource %s outside the WorkOS audience",
    async (resource: string | undefined) => {
      const f = fixture();
      f.document.resource = resource;
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow("resource mismatch");
    }
  );
  test("discovers WorkOS in one request, shares concurrent calls, and refreshes on demand", async () => {
    const f = fixture();
    const [a, b] = await Promise.all([
      discoverAuthServer("https://teak.example/api", { fetch: f.transport }),
      discoverAuthServer("https://teak.example", { fetch: f.transport }),
    ]);
    expect(a).toBe(b);
    expect(a).toEqual({
      primary: "workos",
      issuer: "https://auth.example",
      authorizationEndpoint: "https://auth.example/oauth2/authorize",
      tokenEndpoint: "https://auth.example/oauth2/token",
      resource: "https://teakvault.com/mcp",
      clients: clientIds,
    });
    expect(f.calls).toHaveLength(1);
    expect(Object.isFrozen(a.clients)).toBe(true);
    for (const call of f.calls) {
      expect(call.init).toMatchObject({
        redirect: "error",
        credentials: "omit",
      });
      expect(new Headers(call.init?.headers).has("Authorization")).toBe(false);
    }
    await discoverAuthServer("https://teak.example", {
      fetch: f.transport,
      forceRefresh: true,
    });
    expect(f.calls).toHaveLength(2);
  });
  test.each(["betterauth", undefined, "WorkOS"])(
    "rejects a %s provider as invalid discovery",
    async (primary: string | undefined) => {
      const f = fixture();
      f.document.primary = primary;
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow("Unknown OAuth provider");
    }
  );
  test.each(["https://auth.example/tenant", "https://auth.example/tenant/"])(
    "accepts issuer %s whose endpoints share its origin",
    async (issuer: string) => {
      const f = fixture(issuer);
      expect(
        await discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).toMatchObject({
        issuer,
        tokenEndpoint: "https://auth.example/oauth2/token",
      });
    }
  );
  test.each([
    [
      "an issuer whose origin is not the endpoints'",
      { issuer: "https://other.example" },
      "not on the issuer's origin",
    ],
    [
      "a token endpoint on another origin",
      { token_endpoint: "https://other.example/oauth2/token" },
      "not on the issuer's origin",
    ],
    [
      "an authorize endpoint on another port",
      { authorization_endpoint: "https://auth.example:8443/oauth2/authorize" },
      "not on the issuer's origin",
    ],
    [
      "an issuer with a query",
      { issuer: "https://auth.example?tenant=1" },
      "Invalid OAuth issuer",
    ],
    ["a missing issuer", { issuer: undefined }, "Missing OAuth discovery URL"],
    [
      "a document without endpoints",
      { token_endpoint: undefined },
      "Missing OAuth discovery URL",
    ],
    ["plain PKCE", { code_challenge_methods_supported: ["plain"] }, "S256"],
    [
      "undeclared PKCE",
      { code_challenge_methods_supported: undefined },
      "S256",
    ],
    [
      "an unsafe token URL",
      { token_endpoint: "http://localhost:9999/token" },
      "Unsafe",
    ],
    [
      "a shared address issuer",
      {
        issuer: "https://100.64.0.1",
        authorization_endpoint: "https://100.64.0.1/authorize",
        token_endpoint: "https://100.64.0.1/token",
      },
      "Unsafe",
    ],
    [
      "a loopback URL with a root dot",
      { token_endpoint: "https://localhost./t" },
      "Unsafe",
    ],
    [
      "a local network URL with a root dot",
      { authorization_endpoint: "https://printer.local./login" },
      "Unsafe",
    ],
    [
      "a credential URL",
      { authorization_endpoint: "https://user:secret@auth.example/login" },
      "Unsafe",
    ],
  ])(
    "rejects %s",
    async (_name: string, patch: Record<string, unknown>, message: string) => {
      const f = fixture();
      Object.assign(f.document, patch);
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow(message);
    }
  );
  test("rejects missing client registrations", async () => {
    const f = fixture();
    f.document.clients = { cli: "cli" };
    await expect(
      discoverAuthServer("https://teak.example", { fetch: f.transport })
    ).rejects.toThrow("client registration");
  });
  test.each(["oversized", "malformed", "http failure"])(
    "does not cache %s responses",
    async (failure: string) => {
      const f = fixture();
      const state: { broken: boolean } = { broken: true };
      const transport = asFetch(async (url, init) =>
        state.broken
          ? new Response(failure === "oversized" ? "x".repeat(65_537) : "{", {
              status: failure === "http failure" ? 503 : 200,
            })
          : f.transport(url, init)
      );
      await expect(
        discoverAuthServer("https://teak.example", { fetch: transport })
      ).rejects.toThrow();
      state.broken = false;
      expect(
        await discoverAuthServer("https://teak.example", { fetch: transport })
      ).toMatchObject({ primary: "workos" });
    }
  );
  test("refreshes after the sixty-second cache limit", async () => {
    const f = fixture();
    const original = Date.now;
    let now = original();
    Date.now = () => now;
    try {
      await discoverAuthServer("https://teak.example", { fetch: f.transport });
      now += 60_001;
      await discoverAuthServer("https://teak.example", { fetch: f.transport });
      expect(f.calls).toHaveLength(2);
    } finally {
      Date.now = original;
    }
  });
  test("a stale failed request cannot evict a completed forced refresh", async () => {
    const f = fixture();
    let calls = 0;
    let rejectOld!: (error: Error) => void;
    const transport = asFetch((url, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      }
      return f.transport(url, init);
    });
    const old = discoverAuthServer("https://teak.example", {
      fetch: transport,
    });
    const rejected = old.catch((error) => error);
    const fresh = await discoverAuthServer("https://teak.example", {
      fetch: transport,
      forceRefresh: true,
    });
    rejectOld(new Error("Old transport failed"));
    expect(await rejected).toMatchObject({ message: "Old transport failed" });
    const before = calls;
    expect(
      await discoverAuthServer("https://teak.example", { fetch: transport })
    ).toBe(fresh);
    expect(calls).toBe(before);
  });

  test("times out discovery and allows another attempt", async () => {
    const f = fixture();
    const state: { stalled: boolean } = { stalled: true };
    const transport = asFetch((url, init) =>
      state.stalled
        ? new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("Aborted")),
              { once: true }
            );
          })
        : f.transport(url, init)
    );
    await expect(
      discoverAuthServer("https://teak.example", {
        fetch: transport,
        timeoutMs: 1,
      })
    ).rejects.toThrow("Aborted");
    state.stalled = false;
    expect(
      await discoverAuthServer("https://teak.example", { fetch: transport })
    ).toMatchObject({ primary: "workos" });
  });

  test("allows explicit loopback development while blocking private remote metadata", async () => {
    const f = fixture();
    Object.assign(f.document, {
      issuer: "https://169.254.169.254",
      token_endpoint: "https://169.254.169.254/token",
    });
    await expect(
      discoverAuthServer("https://teak.example", { fetch: f.transport })
    ).rejects.toThrow("Unsafe");
    const issuer = "http://127.0.0.1:3000";
    const transport = asFetch(() =>
      Promise.resolve(Response.json(teakDocument(issuer)))
    );
    expect(
      await discoverAuthServer("http://127.0.0.1:3211", { fetch: transport })
    ).toMatchObject({
      primary: "workos",
      tokenEndpoint: "http://127.0.0.1:3000/oauth2/token",
      resource: "https://teakvault.com/mcp",
    });
  });
  test.each(["http://localhost:3000", "http://app.teak.localhost:3000"])(
    "cloud development requires explicit approval for %s and keeps its cache separate",
    async (issuer: string) => {
      const transport = asFetch(() =>
        Promise.resolve(Response.json(teakDocument(issuer)))
      );
      await expect(
        discoverAuthServer("https://dev.example", { fetch: transport })
      ).rejects.toThrow("Unsafe");
      expect(
        await discoverAuthServer("https://dev.example", {
          fetch: transport,
          localIssuer: issuer,
        })
      ).toMatchObject({ issuer });
      expect(
        await discoverAuthServer(issuer, { fetch: transport })
      ).toMatchObject({ issuer });
      await expect(
        discoverAuthServer("https://dev.example", { fetch: transport })
      ).rejects.toThrow("Unsafe");
    }
  );
});
