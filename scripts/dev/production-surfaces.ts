// Teak's public production endpoints, in one list. The API and MCP smoke
// (scripts/dev/smoke-urls.ts, every 6 hours) checks the `api` group against
// any deployment's base URL; the daily docs suite
// (packages/tests/src/docs/extra-prod-surfaces.e2e.ts) checks all of them
// against production, with their security headers.

export const PRODUCTION_SITE_URL = "https://teakvault.com";
export const PRODUCTION_APP_URL = "https://app.teakvault.com";
/** The API's old subdomain; Cloudflare redirects it to the site. */
export const LEGACY_API_ORIGIN = "https://api.teakvault.com";

export interface Surface {
  /** What the body must contain. */
  body: RegExp;
  group: "api" | "app" | "site";
  kind: "html" | "json" | "text";
  name: string;
  url: string;
}

export interface Redirect {
  from: string;
  to: string;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export const surfaces = (
  siteUrl = PRODUCTION_SITE_URL,
  appUrl = PRODUCTION_APP_URL
): Surface[] => {
  const site = siteUrl.replace(/\/$/, "");
  const mcp = escaped(`${site}/mcp`);
  return [
    {
      group: "site",
      name: "site home",
      url: `${site}/`,
      kind: "html",
      body: /Teak/i,
    },
    {
      group: "site",
      name: "apps directory",
      url: `${site}/apps`,
      kind: "html",
      body: /Teak/i,
    },
    {
      group: "site",
      name: "docs home",
      url: `${site}/docs/`,
      kind: "html",
      body: /Docs|Teak/i,
    },
    {
      group: "site",
      name: "api docs",
      url: `${site}/docs/api/`,
      kind: "html",
      body: /API/i,
    },
    {
      group: "site",
      name: "mcp docs",
      url: `${site}/docs/mcp/`,
      kind: "html",
      body: /MCP/i,
    },
    {
      group: "site",
      name: "cli docs",
      url: `${site}/docs/cli/`,
      kind: "html",
      body: /CLI|teak/i,
    },
    {
      group: "site",
      name: "raycast docs",
      url: `${site}/docs/raycast/`,
      kind: "html",
      body: /Raycast/i,
    },
    {
      group: "site",
      name: "skills docs",
      url: `${site}/docs/skills/`,
      kind: "html",
      body: /Skill|Teak/i,
    },
    {
      group: "site",
      name: "agent skills index",
      url: `${site}/.well-known/agent-skills/index.json`,
      kind: "json",
      body: /"skills"/,
    },
    {
      // A Cloudflare redirect to the site's index (.agents/guides/environment.md, "Rules set outside the repository").
      group: "site",
      name: "api subdomain agent skills index",
      url: `${LEGACY_API_ORIGIN}/.well-known/agent-skills/index.json`,
      kind: "json",
      body: /"skills"/,
    },
    {
      group: "api",
      name: "llms text",
      url: `${site}/llms.txt`,
      kind: "text",
      body: /Teak/i,
    },
    {
      group: "api",
      name: "mcp well known",
      url: `${site}/.well-known/mcp.json`,
      kind: "json",
      body: new RegExp(`"endpoint"\\s*:\\s*"${mcp}"`),
    },
    {
      group: "api",
      name: "api health",
      url: `${site}/api/healthz`,
      kind: "json",
      body: /"status":"ok"/,
    },
    {
      group: "api",
      name: "api root",
      url: `${site}/api`,
      kind: "json",
      body: /"version":"v1"/,
    },
    {
      group: "api",
      name: "api v1",
      url: `${site}/api/v1`,
      kind: "json",
      body: new RegExp(`"endpoint":"${mcp}"`),
    },
    {
      group: "api",
      name: "openapi",
      url: `${site}/api/openapi.json`,
      kind: "json",
      body: /"openapi":"3\.1\.0"/,
    },
    {
      group: "api",
      name: "mcp resource metadata",
      url: `${site}/.well-known/oauth-protected-resource/mcp`,
      kind: "json",
      body: new RegExp(`"resource":"${mcp}"`),
    },
    {
      group: "app",
      name: "app sign-in",
      url: `${appUrl}/sign-in`,
      kind: "html",
      body: /sign in/i,
    },
    {
      group: "app",
      name: "app sign-up",
      url: `${appUrl}/sign-up`,
      kind: "html",
      body: /sign up|account/i,
    },
  ];
};

/**
 * The MCP endpoint refuses an unauthenticated request with a challenge that
 * points at its resource metadata.
 */
export const mcpChallenge = (siteUrl = PRODUCTION_SITE_URL) => {
  const site = siteUrl.replace(/\/$/, "");
  return {
    url: `${site}/mcp`,
    metadata: `${site}/.well-known/oauth-protected-resource/mcp`,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "teak-smoke", version: "1.0.0" },
      },
    },
  };
};

/**
 * The API lived at api.teakvault.com; it now permanently redirects (308 keeps
 * methods) to production, whichever deployment a smoke run targets.
 */
export const legacyApiRedirects = (): Redirect[] =>
  (
    [
      ["/", "/api/v1"],
      ["/v1", "/api/v1"],
      ["/healthz", "/api/healthz"],
      ["/openapi.json", "/api/openapi.json"],
      ["/mcp", "/mcp"],
      [
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-protected-resource/mcp",
      ],
    ] as const
  ).map(([from, to]) => ({
    from: `${LEGACY_API_ORIGIN}${from}`,
    to: `${PRODUCTION_SITE_URL}${to}`,
  }));
