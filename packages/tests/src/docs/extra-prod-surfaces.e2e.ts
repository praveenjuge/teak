import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";

interface Probe {
  body: RegExp;
  kind: "html" | "json" | "text";
  name: string;
  nosniff?: boolean;
  url: string;
}

const probes: Probe[] = [
  { name: "site home", url: `${env.siteUrl}/`, kind: "html", body: /Teak/i },
  {
    name: "apps directory",
    url: `${env.siteUrl}/apps`,
    kind: "html",
    body: /Teak/i,
  },
  {
    name: "docs home",
    url: `${env.siteUrl}/docs/`,
    kind: "html",
    body: /Docs|Teak/i,
  },
  {
    name: "api docs",
    url: `${env.siteUrl}/docs/api/`,
    kind: "html",
    body: /API/i,
  },
  {
    name: "mcp docs",
    url: `${env.siteUrl}/docs/mcp/`,
    kind: "html",
    body: /MCP/i,
  },
  {
    name: "cli docs",
    url: `${env.siteUrl}/docs/cli/`,
    kind: "html",
    body: /CLI|teak/i,
  },
  {
    name: "raycast docs",
    url: `${env.siteUrl}/docs/raycast/`,
    kind: "html",
    body: /Raycast/i,
  },
  {
    name: "skills docs",
    url: `${env.siteUrl}/docs/skills/`,
    kind: "html",
    body: /Skill|Teak/i,
  },
  {
    name: "llms text",
    url: `${env.siteUrl}/llms.txt`,
    kind: "text",
    body: /Teak/i,
  },
  {
    name: "mcp well known",
    url: `${env.siteUrl}/.well-known/mcp.json`,
    kind: "json",
    body: /endpoint/,
  },
  {
    name: "apex api health",
    url: `${env.siteUrl}/api/healthz`,
    kind: "json",
    body: /ok/,
  },
  {
    name: "apex api root",
    url: `${env.siteUrl}/api`,
    kind: "json",
    body: /v1/,
  },
  {
    name: "apex api v1",
    url: `${env.siteUrl}/api/v1`,
    kind: "json",
    body: /endpoint/,
  },
  {
    name: "apex openapi",
    url: `${env.siteUrl}/api/openapi.json`,
    kind: "json",
    body: /openapi/,
  },
  {
    name: "apex mcp resource",
    url: `${env.siteUrl}/.well-known/oauth-protected-resource/mcp`,
    kind: "json",
    body: /resource/,
  },
  {
    name: "app login",
    url: `${env.appUrl}/login`,
    kind: "html",
    body: /login|sign in/i,
  },
  {
    name: "app register",
    url: `${env.appUrl}/register`,
    kind: "html",
    body: /register|account/i,
  },
  {
    name: "app forgot password",
    url: `${env.appUrl}/forgot-password`,
    kind: "html",
    body: /Teak/i,
  },
  {
    name: "api subdomain health",
    url: "https://api.teakvault.com/healthz",
    kind: "json",
    body: /ok/,
    nosniff: false,
  },
  {
    name: "api subdomain v1",
    url: "https://api.teakvault.com/v1",
    kind: "json",
    body: /endpoint/,
    nosniff: false,
  },
  {
    name: "api subdomain openapi",
    url: "https://api.teakvault.com/openapi.json",
    kind: "json",
    body: /openapi/,
    nosniff: false,
  },
];

const contentType = {
  html: /text\/html/,
  json: /application\/json/,
  text: /text\/plain/,
} as const;

for (const [index, probe] of probes.entries()) {
  const prefix = `extra-${String(index + 1).padStart(3, "0")} ${probe.name}`;

  test(`${prefix} status is successful`, async () => {
    expect((await fetch(probe.url)).status).toBeLessThan(400);
  });

  test(`${prefix} content type is stable`, async () => {
    const response = await fetch(probe.url);
    expect(response.headers.get("content-type") ?? "").toMatch(
      contentType[probe.kind]
    );
  });

  test(`${prefix} security headers are present`, async () => {
    const response = await fetch(probe.url);
    expect(response.headers.get("strict-transport-security") ?? "").toContain(
      "max-age"
    );
    if (probe.nosniff !== false) {
      expect(response.headers.get("x-content-type-options") ?? "").toBe(
        "nosniff"
      );
    }
  });

  test(`${prefix} body contains expected product marker`, async () => {
    const body = await fetch(probe.url).then((response) => response.text());
    expect(body).toMatch(probe.body);
  });

  test(`${prefix} body has no obvious server error leak`, async () => {
    const body = await fetch(probe.url).then((response) => response.text());
    expect(body).not.toMatch(
      /Unhandled Runtime Error|Internal Server Error|stack trace/i
    );
  });
}
