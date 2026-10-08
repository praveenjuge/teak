import { describe, expect, test } from "bun:test";
import { discoverAuthServer } from "../client/sdk";

// Failure modes: a non-WorkOS provider, wrong issuer/resource, a registration
// change between documents, missing clients/PKCE, unsafe URLs, redirects,
// oversized/bad JSON, failed cache entries, concurrent discovery, expiry, and a
// stale failure evicting a newer result.
const surfaces = ["cli", "raycast", "chrome", "firefox", "safari"] as const;
const clientIds = Object.fromEntries(
  surfaces.map((surface) => [surface, `client_01${surface.toUpperCase()}`])
);

function fixture(
  issuer = "https://auth.example",
  site = "https://teak.example"
) {
  const documents: Record<string, unknown> = {
    [`${site}/.well-known/oauth-protected-resource/mcp`]: {
      resource: "https://teakvault.com/mcp",
      authorization_servers: [issuer],
    },
    [`${site}/.well-known/teak-oauth-clients.json`]: {
      primary: "workos",
      issuer,
      clients: clientIds,
    },
    [`https://auth.example/.well-known/oauth-authorization-server${new URL(issuer).pathname.replace(/\/$/, "")}`]:
      {
        issuer,
        authorization_endpoint: "https://auth.example/oauth2/authorize",
        token_endpoint: "https://auth.example/oauth2/token",
        code_challenge_methods_supported: ["S256"],
      },
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = (url, init) => {
    const key = String(url);
    calls.push({ url: key, init });
    return Promise.resolve(Response.json(documents[key]));
  };
  return { documents, calls, transport };
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
      expect(
        f.calls.slice(0, 2).map((call) => new URL(call.url).origin)
      ).toEqual([site, site]);
    }
  );
  test.each(["https://other.example/mcp", "https://teak.example/mcp"])(
    "rejects resource %s outside the WorkOS audience",
    async (resource: string) => {
      const f = fixture();
      (
        f.documents[
          "https://teak.example/.well-known/oauth-protected-resource/mcp"
        ] as Record<string, unknown>
      ).resource = resource;
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow("resource mismatch");
    }
  );
  test("discovers WorkOS, shares concurrent calls, and refreshes on demand", async () => {
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
    expect(f.calls).toHaveLength(3);
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
    expect(f.calls).toHaveLength(6);
  });
  test.each(["betterauth", undefined, "WorkOS"])(
    "rejects a %s provider as invalid discovery",
    async (primary: string | undefined) => {
      const f = fixture();
      (
        f.documents[
          "https://teak.example/.well-known/teak-oauth-clients.json"
        ] as Record<string, unknown>
      ).primary = primary;
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow("Unknown OAuth provider");
    }
  );
  test.each(["https://auth.example/tenant", "https://auth.example/tenant/"])(
    "inserts the RFC 8414 well-known path for %s",
    async (issuer: string) => {
      const f = fixture(issuer);
      await discoverAuthServer("https://teak.example", { fetch: f.transport });
      expect(f.calls.map((c) => c.url)).toContain(
        "https://auth.example/.well-known/oauth-authorization-server/tenant"
      );
    }
  );
  test.each([
    ["issuer", { issuer: "https://other.example" }],
    ["PKCE", { code_challenge_methods_supported: ["plain"] }],
    ["unsafe token URL", { token_endpoint: "http://localhost:9999/token" }],
    ["shared address URL", { token_endpoint: "https://100.64.0.1/token" }],
    [
      "credential URL",
      { authorization_endpoint: "https://user:secret@auth.example/login" },
    ],
  ])(
    "rejects invalid %s metadata",
    async (_name: string, patch: Record<string, unknown>) => {
      const f = fixture();
      Object.assign(
        f.documents[
          "https://auth.example/.well-known/oauth-authorization-server"
        ] as object,
        patch
      );
      await expect(
        discoverAuthServer("https://teak.example", { fetch: f.transport })
      ).rejects.toThrow();
    }
  );
  test("rejects a mixed provider snapshot instead of returning stale client IDs", async () => {
    const f = fixture();
    (
      f.documents[
        "https://teak.example/.well-known/teak-oauth-clients.json"
      ] as Record<string, unknown>
    ).issuer = "https://new.example";
    await expect(
      discoverAuthServer("https://teak.example", { fetch: f.transport })
    ).rejects.toThrow("configuration changed");
  });
  test("rejects missing client registrations and the wrong vault resource", async () => {
    const f = fixture();
    (
      f.documents[
        "https://teak.example/.well-known/teak-oauth-clients.json"
      ] as Record<string, unknown>
    ).clients = { cli: "cli" };
    await expect(
      discoverAuthServer("https://teak.example", { fetch: f.transport })
    ).rejects.toThrow("client registration");
    const g = fixture();
    (
      g.documents[
        "https://teak.example/.well-known/oauth-protected-resource/mcp"
      ] as Record<string, unknown>
    ).resource = "https://other.example/mcp";
    await expect(
      discoverAuthServer("https://teak.example", { fetch: g.transport })
    ).rejects.toThrow("resource mismatch");
  });
  test.each(["oversized", "malformed", "http failure"])(
    "does not cache %s responses",
    async (failure: string) => {
      const f = fixture();
      let broken = true;
      const transport: typeof fetch = async (url, init) =>
        broken
          ? new Response(failure === "oversized" ? "x".repeat(65_537) : "{", {
              status: failure === "http failure" ? 503 : 200,
            })
          : f.transport(url, init);
      await expect(
        discoverAuthServer("https://teak.example", { fetch: transport })
      ).rejects.toThrow();
      broken = false;
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
      expect(f.calls).toHaveLength(6);
    } finally {
      Date.now = original;
    }
  });
  test("a stale failed request cannot evict a completed forced refresh", async () => {
    const f = fixture();
    let calls = 0;
    let rejectOld!: (error: Error) => void;
    const transport: typeof fetch = (url, init) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          rejectOld = reject;
        });
      }
      return f.transport(url, init);
    };
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

  test("failed discovery aborts its stalled sibling and permits retry", async () => {
    const f = fixture();
    let broken = true;
    let aborted = false;
    const transport: typeof fetch = (url, init) => {
      if (!broken) {
        return f.transport(url, init);
      }
      if (String(url).includes("oauth-protected-resource")) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("Aborted sibling"));
          },
          { once: true }
        );
      });
    };
    await expect(
      discoverAuthServer("https://teak.example", { fetch: transport })
    ).rejects.toThrow("request failed");
    expect(aborted).toBe(true);
    broken = false;
    expect(
      await discoverAuthServer("https://teak.example", { fetch: transport })
    ).toMatchObject({ primary: "workos" });
  });

  test("times out discovery and allows another attempt", async () => {
    const f = fixture();
    let stalled = true;
    const transport: typeof fetch = (url, init) =>
      stalled
        ? new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("Aborted")),
              { once: true }
            );
          })
        : f.transport(url, init);
    await expect(
      discoverAuthServer("https://teak.example", {
        fetch: transport,
        timeoutMs: 1,
      })
    ).rejects.toThrow("Aborted");
    stalled = false;
    expect(
      await discoverAuthServer("https://teak.example", { fetch: transport })
    ).toMatchObject({ primary: "workos" });
  });

  test("allows explicit loopback development while blocking private remote metadata", async () => {
    const f = fixture();
    (
      f.documents[
        "https://auth.example/.well-known/oauth-authorization-server"
      ] as Record<string, unknown>
    ).token_endpoint = "https://169.254.169.254/token";
    await expect(
      discoverAuthServer("https://teak.example", { fetch: f.transport })
    ).rejects.toThrow("Unsafe");
    const issuer = "http://127.0.0.1:3000";
    const transport: typeof fetch = (url) => {
      if (String(url).endsWith("teak-oauth-clients.json")) {
        return Promise.resolve(
          Response.json({
            primary: "workos",
            issuer,
            clients: clientIds,
          })
        );
      }
      if (String(url).includes("oauth-protected-resource")) {
        return Promise.resolve(
          Response.json({
            resource: "https://teakvault.com/mcp",
            authorization_servers: [issuer],
          })
        );
      }
      return Promise.resolve(
        Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          code_challenge_methods_supported: ["S256"],
        })
      );
    };
    expect(
      await discoverAuthServer("http://127.0.0.1:3211", { fetch: transport })
    ).toMatchObject({
      primary: "workos",
      tokenEndpoint: "http://127.0.0.1:3000/token",
      resource: "https://teakvault.com/mcp",
    });
  });
  test.each(["http://localhost:3000", "http://app.teak.localhost:3000"])(
    "cloud development requires explicit approval for %s and keeps its cache separate",
    async (issuer: string) => {
      const transport: typeof fetch = (url) => {
        if (String(url).endsWith("teak-oauth-clients.json")) {
          return Promise.resolve(
            Response.json({
              primary: "workos",
              issuer,
              clients: clientIds,
            })
          );
        }
        if (String(url).includes("oauth-protected-resource")) {
          return Promise.resolve(
            Response.json({
              resource: "https://teakvault.com/mcp",
              authorization_servers: [issuer],
            })
          );
        }
        return Promise.resolve(
          Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            code_challenge_methods_supported: ["S256"],
          })
        );
      };
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
