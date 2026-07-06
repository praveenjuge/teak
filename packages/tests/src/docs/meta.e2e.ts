import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";

test("llms, OpenAPI, and OAuth metadata are fresh", async () => {
  expect(await fetch(`${env.siteUrl}/llms.txt`).then((r) => r.status)).toBe(
    200
  );
  const spec = await fetch(`${env.apiUrl}/openapi.json`).then(
    (r) => r.json() as any
  );
  for (const path of [
    "/v1/cards",
    "/v1/uploads",
    "/v1/cards/bulk",
    "/v1/cards/search",
    "/v1/cards/favorites",
    "/v1/tags",
  ]) {
    expect(spec.paths[path], path).toBeTruthy();
  }
  const protectedResource = await fetch(
    `${env.siteUrl}/.well-known/oauth-protected-resource/mcp`
  );
  expect(protectedResource.status).toBe(200);
  expect(await protectedResource.json()).toMatchObject({
    resource: env.mcpUrl,
  });
});
