import { published } from "../helpers/env";
import { expect, test } from "../helpers/test";

test("llms, OpenAPI, and OAuth metadata are fresh", async () => {
  const llmsResponse = await fetch(`${published.siteUrl}/llms.txt`);
  expect(llmsResponse.status).toBe(200);
  const llms = await llmsResponse.text();
  expect(llms).toContain("\n## When to use Teak\n");
  expect(llms).toContain(
    "Use Teak when a person wants to keep knowledge beyond the current conversation"
  );
  const robotsResponse = await fetch(`${published.siteUrl}/robots.txt`);
  expect(robotsResponse.status).toBe(200);
  // The API reference prints signed-in API URLs in its code samples; Google
  // must not crawl them as pages.
  const robots = await robotsResponse.text();
  expect(robots).toContain("\nDisallow: /api/v1/\n");
  expect(robots).toContain("\nDisallow: /mcp\n");
  expect(
    await fetch(`${published.siteUrl}/agent-readability.json`).then(
      (r) => r.status
    )
  ).toBe(200);
  const spec = await fetch(`${published.apiUrl}/openapi.json`).then(
    (r) => r.json() as any
  );
  for (const path of [
    "/v1/cards",
    "/v1/uploads",
    "/v1/cards/bulk",
    "/v1/tags",
  ]) {
    expect(spec.paths[path], path).toBeTruthy();
  }
  const protectedResource = await fetch(
    `${published.siteUrl}/.well-known/oauth-protected-resource/mcp`
  );
  expect(protectedResource.status).toBe(200);
  expect(await protectedResource.json()).toMatchObject({
    resource: published.mcpUrl,
  });
});
