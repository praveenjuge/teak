import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

interface Probe {
  body: RegExp;
  kind: "html" | "json" | "text";
  name: string;
  nosniff?: boolean;
  url: string;
}

const probes: Probe[] = [
  {
    name: "site home",
    url: `${published.siteUrl}/`,
    kind: "html",
    body: /Teak/i,
  },
  {
    name: "apps directory",
    url: `${published.siteUrl}/apps`,
    kind: "html",
    body: /Teak/i,
  },
  {
    name: "docs home",
    url: `${published.siteUrl}/docs/`,
    kind: "html",
    body: /Docs|Teak/i,
  },
  {
    name: "api docs",
    url: `${published.siteUrl}/docs/api/`,
    kind: "html",
    body: /API/i,
  },
  {
    name: "mcp docs",
    url: `${published.siteUrl}/docs/mcp/`,
    kind: "html",
    body: /MCP/i,
  },
  {
    name: "cli docs",
    url: `${published.siteUrl}/docs/cli/`,
    kind: "html",
    body: /CLI|teak/i,
  },
  {
    name: "raycast docs",
    url: `${published.siteUrl}/docs/raycast/`,
    kind: "html",
    body: /Raycast/i,
  },
  {
    name: "skills docs",
    url: `${published.siteUrl}/docs/skills/`,
    kind: "html",
    body: /Skill|Teak/i,
  },
  {
    name: "llms text",
    url: `${published.siteUrl}/llms.txt`,
    kind: "text",
    body: /Teak/i,
  },
  {
    name: "mcp well known",
    url: `${published.siteUrl}/.well-known/mcp.json`,
    kind: "json",
    body: /endpoint/,
  },
  {
    name: "agent skills index",
    url: `${published.siteUrl}/.well-known/agent-skills/index.json`,
    kind: "json",
    body: /"skills"/,
  },
  {
    // A Cloudflare redirect to the teakvault.com index (.agents/guides/environment.md, "Rules set outside the repository").
    name: "api subdomain agent skills index",
    url: "https://api.teakvault.com/.well-known/agent-skills/index.json",
    kind: "json",
    body: /"skills"/,
  },
  {
    name: "apex api health",
    url: `${published.siteUrl}/api/healthz`,
    kind: "json",
    body: /ok/,
  },
  {
    name: "apex api root",
    url: `${published.siteUrl}/api`,
    kind: "json",
    body: /v1/,
  },
  {
    name: "apex api v1",
    url: `${published.siteUrl}/api/v1`,
    kind: "json",
    body: /endpoint/,
  },
  {
    name: "apex openapi",
    url: `${published.siteUrl}/api/openapi.json`,
    kind: "json",
    body: /openapi/,
  },
  {
    name: "apex mcp resource",
    url: `${published.siteUrl}/.well-known/oauth-protected-resource/mcp`,
    kind: "json",
    body: /resource/,
  },
  {
    name: "app sign-in",
    url: `${published.appUrl}/sign-in`,
    kind: "html",
    body: /sign in/i,
  },
  {
    name: "app sign-up",
    url: `${published.appUrl}/sign-up`,
    kind: "html",
    body: /sign up|account/i,
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

const fetchWithNetworkRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  throw lastError;
};

for (const [index, probe] of probes.entries()) {
  const prefix = `extra-${String(index + 1).padStart(3, "0")} ${probe.name}`;

  test(`${prefix} production response contract`, async () => {
    const response = await fetchWithNetworkRetry(probe.url);
    const body = await response.text();

    expect(response.status, "status is successful").toBeLessThan(400);
    expect(
      response.headers.get("content-type") ?? "",
      "content type is stable"
    ).toMatch(contentType[probe.kind]);
    expect(
      response.headers.get("strict-transport-security") ?? "",
      "security headers are present"
    ).toContain("max-age");
    if (probe.nosniff !== false) {
      expect(
        response.headers.get("x-content-type-options") ?? "",
        "security headers are present"
      ).toBe("nosniff");
    }
    expect(body, "body contains expected product marker").toMatch(probe.body);
    expect(body, "body has no obvious server error leak").not.toMatch(
      /Unhandled Runtime Error|Internal Server Error|stack trace/i
    );
  });
}

interface AmoAddon {
  current_version?: { version: string };
  guid: string;
  slug: string;
  status: string;
}

// The listing page answers scripted requests with a bot challenge, so this
// reads AMO's public API. It answers 401 until the add-on has a public version.
test("extra Firefox add-on is listed on AMO at the slug the docs link to", async () => {
  const response = await fetchWithNetworkRetry(
    "https://addons.mozilla.org/api/v5/addons/addon/teak/"
  );
  expect(response.status, "the listing is public").toBe(200);
  const addon = (await response.json()) as AmoAddon;
  expect(addon.guid).toBe("teak@teakvault.com");
  expect(addon.slug).toBe("teak");
  expect(addon.status).toBe("public");
  expect(addon.current_version?.version ?? "").toMatch(/^\d+\.\d+\.\d+$/);
});

interface SkillsIndex {
  skills: { digest: string; name: string; type: string; url: string }[];
}

const sha256 = (bytes: ArrayBuffer | Buffer) =>
  `sha256:${createHash("sha256")
    .update(new Uint8Array(bytes as ArrayBuffer))
    .digest("hex")}`;

test("extra agent skills index matches what it serves and this checkout", async () => {
  const indexUrl = `${published.siteUrl}/.well-known/agent-skills/index.json`;
  const response = await fetchWithNetworkRetry(indexUrl);
  expect(
    response.headers.get("access-control-allow-origin"),
    "any agent can read the index"
  ).toBe("*");
  const index = (await response.json()) as SkillsIndex;
  expect(index.skills.map((skill) => skill.name)).toContain("teak");
  for (const skill of index.skills) {
    const artifact = await fetchWithNetworkRetry(
      new URL(skill.url, indexUrl).toString()
    );
    expect(artifact.status, `${skill.name} artifact is served`).toBe(200);
    expect(
      artifact.headers.get("access-control-allow-origin"),
      `${skill.name} artifact is readable cross-origin`
    ).toBe("*");
    expect(
      sha256(await artifact.arrayBuffer()),
      `${skill.name} digest matches the served file`
    ).toBe(skill.digest);
  }
  const teak = index.skills.find((skill) => skill.name === "teak");
  const local = readFileSync(
    new URL("../../../../.agents/skills/teak/SKILL.md", import.meta.url)
  );
  expect(teak?.type).toBe("skill-md");
  expect(teak?.digest, "teak digest matches .agents/skills/teak").toBe(
    sha256(local)
  );
});
