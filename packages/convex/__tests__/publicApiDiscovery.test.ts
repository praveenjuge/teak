// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  discoveryV1,
  notFound,
  openApiJson,
} from "../publicApiDiscovery";
import { openApiSpec } from "../openapi";
import { resolveTeakDevApiUrl } from "../devUrls";

const runHandler = async (fn: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler({}, request);
};

const docsPath = path.resolve(
  import.meta.dir,
  "../../../apps/docs/src/content/docs/docs/api.mdx"
);

describe("public API discovery", () => {
  test("returns API capabilities for /v1", async () => {
    const response = await runHandler(
      discoveryV1,
      new Request("https://api.teakvault.com/v1")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.version).toBe("v1");
    expect(payload.endpoints).toContain("GET /v1/cards");
    expect(payload.endpoints).toContain("POST /v1/cards/bulk");
    expect(payload.endpoints).toContain("GET /v1/cards/changes");
    expect(payload.endpoints).toContain("GET /v1/tags");
    expect(payload.mcp).toEqual({
      endpoint: "https://api.teakvault.com/mcp",
      transport: "streamable-http",
      auth: "Authorization: Bearer <api_key>",
    });
  });

  test("serves openapi.json from Convex", async () => {
    const response = await runHandler(
      openApiJson,
      new Request("https://api.teakvault.com/openapi.json")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiSpec);
  });

  test("uses the Convex local site URL in the OpenAPI spec", () => {
    expect(openApiSpec.servers).toEqual([
      { url: "https://api.teakvault.com" },
      { url: resolveTeakDevApiUrl(process.env) },
    ]);
  });

  test("documents key routes in both mdx and openapi", () => {
    const docs = readFileSync(docsPath, "utf8");
    const requiredPaths = [
      "/openapi.json",
      "/v1/cards",
      "/v1/cards/bulk",
      "/v1/cards/changes",
      "/v1/tags",
      "/v1/cards/:cardId",
      "/v1/cards/:cardId/favorite",
    ];

    for (const route of requiredPaths) {
      expect(docs).toContain(route);
    }

    expect(openApiSpec.paths).toHaveProperty("/v1/cards");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/bulk");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/changes");
    expect(openApiSpec.paths).toHaveProperty("/v1/tags");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/{cardId}");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/{cardId}/favorite");
  });

  test("returns stable JSON 404 for unknown routes", async () => {
    const response = await runHandler(
      notFound,
      new Request("https://api.teakvault.com/")
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      error: "Route not found",
    });
  });
});
