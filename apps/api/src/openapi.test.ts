import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveTeakDevApiUrl } from "@teak/convex/dev-urls";
import app from "./index";
import { openApiSpec } from "./openapi";

const docsPath = path.resolve(
  import.meta.dir,
  "../../docs/content/docs/api.mdx"
);

describe("openapi", () => {
  test("serves openapi.json", async () => {
    const response = await app.request("/openapi.json");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(openApiSpec);
  });

  test("uses the portless local server URL in the OpenAPI spec", () => {
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
});
