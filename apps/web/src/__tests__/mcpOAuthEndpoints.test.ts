import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  mcpJwks,
  mcpOAuthPreflight,
  mcpUserInfo,
} from "@/lib/mcp-oauth-endpoints";
import { proxyAuthorizationServerMetadata } from "@/lib/oauth-metadata-proxy";

const originalFetch = globalThis.fetch;
const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalConvexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL = originalConvexSiteUrl;
});

describe("MCP OAuth metadata and endpoints", () => {
  test("normalizes authorization-server metadata to supported OAuth scopes and live routes", async () => {
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://example.convex.site";
    globalThis.fetch = mock(() =>
      Response.json({
        issuer: "https://app.teakvault.com",
        authorization_endpoint:
          "https://app.teakvault.com/api/auth/mcp/authorize",
        token_endpoint: "https://app.teakvault.com/api/auth/mcp/token",
        registration_endpoint:
          "https://app.teakvault.com/api/auth/mcp/register",
        userinfo_endpoint: "https://app.teakvault.com/api/auth/mcp/userinfo",
        jwks_uri: "https://app.teakvault.com/api/auth/mcp/jwks",
        scopes_supported: ["openid", "profile", "email", "offline_access"],
        id_token_signing_alg_values_supported: ["RS256"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      })
    ) as unknown as typeof fetch;

    const response = await proxyAuthorizationServerMetadata();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.scopes_supported).toEqual([
      "profile",
      "email",
      "offline_access",
    ]);
    expect(body.userinfo_endpoint).toBe(
      "https://app.teakvault.com/api/auth/mcp/userinfo"
    );
    expect(body.jwks_uri).toBe("https://app.teakvault.com/api/auth/mcp/jwks");
    expect(body).not.toHaveProperty("id_token_signing_alg_values_supported");
  });

  test("serves MCP userinfo from a valid bearer token", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://example.convex.cloud/api/query");
      return Response.json({
        status: "success",
        value: {
          sub: "user_1",
          email: "hello@example.com",
          email_verified: true,
          name: "Ada Lovelace",
        },
      });
    }) as unknown as typeof fetch;

    const response = await mcpUserInfo(
      new Request("https://app.teakvault.com/api/auth/mcp/userinfo", {
        headers: { Authorization: `Bearer ${"a".repeat(32)}` },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sub: "user_1",
      email: "hello@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });
  });

  test("rejects MCP userinfo without a bearer token", async () => {
    const response = await mcpUserInfo(
      new Request("https://app.teakvault.com/api/auth/mcp/userinfo")
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  test("serves MCP JWKS from the Convex auth JWKS source", async () => {
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://example.convex.site/";
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://example.convex.site/api/auth/convex/jwks"
      );
      return Response.json({ keys: [{ kid: "key_1" }] });
    }) as unknown as typeof fetch;

    const response = await mcpJwks();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ keys: [{ kid: "key_1" }] });
  });

  test("answers OAuth endpoint preflight with CORS", () => {
    const response = mcpOAuthPreflight();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
  });
});
