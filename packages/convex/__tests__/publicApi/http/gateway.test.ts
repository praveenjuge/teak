import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CardWithUrls } from "../../../card/queryUtils";
import { serializeListCard } from "../../../publicApi/http/serializers";
import { testId } from "../../helpers/convex.test-utils";

const listCard = (
  fields: Pick<CardWithUrls, "_id" | "type"> & Partial<CardWithUrls>
): CardWithUrls => ({
  _creationTime: 1,
  content: "",
  createdAt: 1,
  updatedAt: 1,
  userId: "user_1",
  ...fields,
});

import {
  discoveryV1,
  healthzV1,
  V1_ENDPOINTS,
  v1CorsPreflight,
} from "../../../publicApi/http/meta";
import { openApiSpec, openApiV1 } from "../../../publicApi/openApi/spec";
import { PUBLIC_API_OPERATION_IDS } from "../../../shared/publicApiContract";

const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

const docsPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../../../apps/docs/content/docs/(developers)/api.mdx"
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
      endpoint: "https://teakvault.com/mcp",
      transport: "streamable-http",
      auth: "Authorization: Bearer <token> (OAuth access token or teakapi_ API key)",
    });
  });

  test("keeps the public MCP URL behind the production Convex proxy", async () => {
    const response = await runHandler(
      discoveryV1,
      {},
      new Request("https://uncommon-ladybug-882.convex.site/v1")
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.mcp.endpoint).toBe("https://teakvault.com/mcp");
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
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT"
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

  test("documents metadata and processing fields emitted in list responses", () => {
    const card = serializeListCard(
      listCard({
        _id: testId("cards", "card_1"),
        type: "link",
        createdAt: 1,
        updatedAt: 1,
        tags: [],
        aiTags: [],
      }),
      "https://api.teakvault.com",
      new Set(["metadata", "processing"])
    );
    const properties = openApiSpec.components.schemas.CardListItem.properties;
    for (const field of Object.keys(card)) {
      expect(properties).toHaveProperty(field);
    }
  });

  test("serializes a video's scrub strip and an audio waveform", () => {
    const waveform = { detail: [1, 2], grid: [3] };
    const video = serializeListCard(
      listCard({
        _id: testId("cards", "card_video"),
        type: "video",
        createdAt: 1,
        updatedAt: 1,
        scrubUrl: "https://files.teakvault.com/strip",
        fileMetadata: {
          scrub: { frameHeight: 180, frameWidth: 320, frames: 10 },
        },
      }),
      "https://api.teakvault.com",
      new Set(["metadata"])
    );
    const audio = serializeListCard(
      listCard({
        _id: testId("cards", "card_audio"),
        type: "audio",
        createdAt: 1,
        updatedAt: 1,
        fileMetadata: { waveform },
      }),
      "https://api.teakvault.com",
      new Set(["metadata"])
    );

    expect(video).toMatchObject({
      audioWaveform: null,
      videoScrub: {
        frameHeight: 180,
        frameWidth: 320,
        frames: 10,
        url: "https://files.teakvault.com/strip",
      },
    });
    expect(audio).toMatchObject({ audioWaveform: waveform, videoScrub: null });
  });

  test("uses the Convex dev site URL in the OpenAPI spec", () => {
    expect(openApiSpec.servers).toEqual([
      { url: "https://teakvault.com/api" },
      { url: "https://api.teakvault.com" },
      { url: "https://reminiscent-kangaroo-59.convex.site" },
    ]);
  });

  test("the API page documents every /v1 method and path", () => {
    const docs = readFileSync(docsPath, "utf8");
    const tableRow = (path: string) =>
      docs.split("\n").find((line) => line.startsWith(`| \`${path}\` |`)) ?? "";
    const undocumented = V1_ENDPOINTS.filter((endpoint) => {
      const [method = "", path = ""] = endpoint.split(" ");
      return !(docs.includes(endpoint) || tableRow(path).includes(method));
    });
    expect(docs).toContain("/openapi.json");
    expect(undocumented).toEqual([]);
  });

  test("documents revocation-only Connect authentication without a request body", () => {
    const operation = openApiSpec.paths["/v1/oauth/disconnect"].post;
    expect(operation.security).toEqual([{ connectRevocation: [] }]);
    expect(operation).not.toHaveProperty("requestBody");
    expect(operation.responses).toHaveProperty("204");
    expect(operation.responses).toHaveProperty("401");
    expect(operation.responses).toHaveProperty("503");
  });

  test("gives every OpenAPI operation a unique operationId", () => {
    const operationIds = Object.values(openApiSpec.paths).flatMap((path) =>
      Object.values(path).map((operation) => operation.operationId)
    );

    expect(operationIds).toHaveLength(PUBLIC_API_OPERATION_IDS.length);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.every(Boolean)).toBe(true);
  });

  test("no longer advertises the removed search routes", async () => {
    const response = await runHandler(
      discoveryV1,
      {},
      new Request("https://api.teakvault.com/v1")
    );

    const payload = await response.json();
    expect(payload.endpoints).not.toContain("GET /v1/cards/search");
    expect(payload.endpoints).not.toContain("GET /v1/cards/favorites");
    expect(openApiSpec.paths).not.toHaveProperty("/v1/cards/search");
    expect(openApiSpec.paths).not.toHaveProperty("/v1/cards/favorites");
    expect(openApiSpec.components.schemas).not.toHaveProperty(
      "LegacyCardsResponse"
    );
  });
});
