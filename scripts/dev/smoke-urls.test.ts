import { expect, test } from "bun:test";
import { legacyApiRedirects, surfaces } from "./production-surfaces.ts";
import { smoke } from "./smoke-urls.ts";

const SITE = "https://preview.example.org";

/** A deployment that answers every API and MCP check the way production does. */
const healthy = (overrides: Record<string, Response> = {}) => {
  const answers: Record<string, () => Response> = {
    [`${SITE}/llms.txt`]: () => new Response("# Teak"),
    [`${SITE}/.well-known/mcp.json`]: () =>
      Response.json({ endpoint: `${SITE}/mcp` }),
    [`${SITE}/api/healthz`]: () => Response.json({ status: "ok" }),
    [`${SITE}/api`]: () => Response.json({ version: "v1" }),
    [`${SITE}/api/v1`]: () => Response.json({ endpoint: `${SITE}/mcp` }),
    [`${SITE}/api/openapi.json`]: () => Response.json({ openapi: "3.1.0" }),
    [`${SITE}/.well-known/oauth-protected-resource/mcp`]: () =>
      Response.json({ resource: `${SITE}/mcp` }),
    [`${SITE}/mcp`]: () =>
      new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp"`,
        },
      }),
    ...Object.fromEntries(
      legacyApiRedirects().map(({ from, to }) => [
        from,
        () => new Response(null, { status: 308, headers: { Location: to } }),
      ])
    ),
  };
  return (url: string) => {
    const override = overrides[url];
    const answer = override ? () => override : answers[url];
    return Promise.resolve(
      answer ? answer() : new Response(null, { status: 404 })
    );
  };
};

test("a healthy deployment passes, with the legacy redirects pointing at production", async () => {
  expect(await smoke(SITE, healthy())).toEqual([]);
});

test("an MCP endpoint pointing at another origin fails", async () => {
  const failures = await smoke(
    SITE,
    healthy({
      [`${SITE}/api/v1`]: Response.json({
        endpoint: "https://teakvault.com/mcp",
      }),
    })
  );
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain(`${SITE}/api/v1`);
});

test("an MCP challenge without resource metadata fails", async () => {
  const failures = await smoke(
    SITE,
    healthy({
      [`${SITE}/mcp`]: new Response(null, {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      }),
    })
  );
  expect(failures).toEqual([
    `WWW-Authenticate for ${SITE}/mcp did not reference ${SITE}/.well-known/oauth-protected-resource/mcp: Bearer`,
  ]);
});

test("a legacy redirect that isn't permanent fails", async () => {
  const [first] = legacyApiRedirects();
  const failures = await smoke(
    SITE,
    healthy({
      [first?.from ?? ""]: new Response(null, {
        status: 302,
        headers: { Location: first?.to ?? "" },
      }),
    })
  );
  expect(failures).toEqual([`Expected 308 for ${first?.from}, got 302`]);
});

test("every surface has a unique name", () => {
  const names = surfaces().map((surface) => surface.name);
  expect(new Set(names).size).toBe(names.length);
});
