import { describe, expect, test } from "bun:test";
import { discoverAuthServer } from "../client/sdk";

// Failure modes: wrong issuer/resource, a flag flip between documents, missing
// clients/PKCE, unsafe URLs, redirects, oversized/bad JSON, failed cache entries,
// concurrent discovery, expiry, and a stale failure evicting a newer result.
function fixture(
  primary: "betterauth" | "workos" = "betterauth",
  issuer = "https://auth.example"
) {
  const documents: Record<string, unknown> = {
    "https://teak.example/.well-known/oauth-protected-resource/mcp": {
      resource: "https://teak.example/mcp",
      authorization_servers: [issuer],
    },
    "https://teak.example/.well-known/teak-oauth-clients.json": {
      primary,
      issuer,
      clients: Object.fromEntries(
        ["cli", "raycast", "chrome", "firefox", "safari"].map((surface) => [
          surface,
          `${primary}-${surface}`,
        ])
      ),
    },
    [`https://auth.example/.well-known/oauth-authorization-server${new URL(issuer).pathname.replace(/\/$/, "")}`]:
      {
        issuer,
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        revocation_endpoint: "https://auth.example/revoke",
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
  test.each(["betterauth", "workos"] as const)(
    "discovers %s, shares concurrent calls, and refreshes on demand",
    async (primary: "betterauth" | "workos") => {
      const f = fixture(primary);
      const [a, b] = await Promise.all([
        discoverAuthServer("https://teak.example/api", { fetch: f.transport }),
        discoverAuthServer("https://teak.example", { fetch: f.transport }),
      ]);
      expect(a).toBe(b);
      expect(a).toMatchObject({
        primary,
        issuer: "https://auth.example",
        tokenEndpoint: "https://auth.example/token",
        clients: { cli: `${primary}-cli` },
      });
      expect(f.calls).toHaveLength(3);
      expect(Object.isFrozen(a.clients)).toBe(true);
      for (const call of f.calls) {
        expect(call.init).toMatchObject({
          redirect: "error",
          credentials: "omit",
        });
        expect(new Headers(call.init?.headers).has("Authorization")).toBe(
          false
        );
      }
      await discoverAuthServer("https://teak.example", {
        fetch: f.transport,
        forceRefresh: true,
      });
      expect(f.calls).toHaveLength(6);
    }
  );
  test.each(["https://auth.example/tenant", "https://auth.example/tenant/"])(
    "inserts the RFC 8414 well-known path for %s",
    async (issuer: string) => {
      const f = fixture("workos", issuer);
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
      ).toMatchObject({ primary: "betterauth" });
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
    ).toMatchObject({ primary: "betterauth" });
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
    ).toMatchObject({ primary: "betterauth" });
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
            primary: "betterauth",
            issuer,
            clients: {
              cli: "cli",
              raycast: "raycast",
              chrome: "chrome",
              firefox: "firefox",
              safari: "safari",
            },
          })
        );
      }
      if (String(url).includes("oauth-protected-resource")) {
        return Promise.resolve(
          Response.json({
            resource: "http://127.0.0.1:3211/mcp",
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
      primary: "betterauth",
      tokenEndpoint: "http://127.0.0.1:3000/token",
    });
  });
  test.each(["http://localhost:3000", "http://app.teak.localhost:3000"])(
    "cloud development requires explicit approval for %s and keeps its cache separate",
    async (issuer: string) => {
      const transport: typeof fetch = (url) => {
        if (String(url).endsWith("teak-oauth-clients.json")) {
          return Promise.resolve(
            Response.json({
              primary: "betterauth",
              issuer,
              clients: {
                cli: "cli",
                raycast: "raycast",
                chrome: "chrome",
                firefox: "firefox",
                safari: "safari",
              },
            })
          );
        }
        if (String(url).includes("oauth-protected-resource")) {
          return Promise.resolve(
            Response.json({
              resource: "https://dev.example/mcp",
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
      const localTransport: typeof fetch = async (url, init) => {
        const response = await transport(url, init);
        const body = await response.json();
        if (body.resource) {
          body.resource = `${issuer}/mcp`;
        }
        return Response.json(body);
      };
      expect(
        await discoverAuthServer(issuer, { fetch: localTransport })
      ).toMatchObject({ issuer });
      await expect(
        discoverAuthServer("https://dev.example", { fetch: transport })
      ).rejects.toThrow("Unsafe");
    }
  );
});
