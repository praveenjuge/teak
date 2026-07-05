import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { discoveryV1, healthzV1, v1CorsPreflight } from "../publicApiMeta";
import { openApiSpec, openApiV1 } from "../publicApiOpenApi";

const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

const docsPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../apps/docs/src/content/docs/docs/api.mdx"
);

describe("Convex public API metadata", () => {
  test("returns health status with gateway headers", async () => {
    const response = await runHandler(
      healthzV1,
      {},
      new Request("https://api.teakvault.com/healthz")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "teak-api",
      version: "v1",
    });
  });

  test("returns API capabilities for /v1", async () => {
    const response = await runHandler(
      discoveryV1,
      {},
      new Request("https://api.teakvault.com/v1")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.version).toBe("v1");
    expect(payload.endpoints).toContain("POST /v1/cards");
    expect(payload.endpoints).toContain("POST /v1/uploads");
    expect(payload.mcp).toEqual({
      endpoint: "https://api.teakvault.com/mcp",
      transport: "streamable-http",
      auth: "Authorization: Bearer <token> (OAuth access token or teakapi_ API key)",
    });
  });

  test("answers REST CORS preflight", async () => {
    const response = await runHandler(
      v1CorsPreflight,
      {},
      new Request("https://api.teakvault.com/v1/cards", {
        method: "OPTIONS",
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PATCH"
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Idempotency-Key"
    );
  });

  test("serves openapi.json", async () => {
    const response = await runHandler(
      openApiV1,
      {},
      new Request("https://api.teakvault.com/openapi.json")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiSpec);
  });

  test("uses the Convex dev site URL in the OpenAPI spec", () => {
    expect(openApiSpec.servers).toEqual([
      { url: "https://api.teakvault.com" },
      { url: "https://reminiscent-kangaroo-59.convex.site" },
    ]);
  });

  test("documents key routes in both mdx and openapi", () => {
    const docs = readFileSync(docsPath, "utf8");
    const requiredPaths = [
      "/openapi.json",
      "/v1/cards",
      "/v1/uploads",
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
    expect(openApiSpec.paths).toHaveProperty("/v1/uploads");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/bulk");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/changes");
    expect(openApiSpec.paths).toHaveProperty("/v1/tags");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/{cardId}");
    expect(openApiSpec.paths).toHaveProperty("/v1/cards/{cardId}/favorite");
  });
});
