import { describe, expect, test } from "bun:test";
import type { CardWithUrls } from "../../../card/queryUtils";
import {
  serializeCard,
  serializeFolder,
  serializeFolderRuleRun,
  serializeHighlight,
  serializeListCard,
  serializeTagOperation,
} from "../../../publicApi/http/serializers";
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
  v1CorsPreflight,
} from "../../../publicApi/http/meta";
import { openApiSpec, openApiV1 } from "../../../publicApi/openApi/spec";
import {
  CARD_LIST_INCLUDES,
  PUBLIC_API_OPERATION_IDS,
} from "../../../shared/publicApiContract";

const runHandler = (fn: any, ctx: any, request: Request) => {
  const handler = (fn as any).handler ?? fn;
  return handler(ctx, request);
};

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

  // Every serializer leaves out no key (none is optional), so one sample of
  // each shows the full set of fields the API sends.
  const documented = (schema: keyof typeof openApiSpec.components.schemas) =>
    Object.keys(
      (openApiSpec.components.schemas[schema] as { properties: object })
        .properties
    ).sort();
  const sent = (value: object) => Object.keys(value).sort();
  const sampleCard = listCard({
    _id: testId("cards", "card_1"),
    type: "link",
    tags: [],
    aiTags: [],
  });

  test.each([
    [
      "CardListItem",
      serializeListCard(
        sampleCard,
        "https://api.teakvault.com",
        new Set(CARD_LIST_INCLUDES)
      ),
    ],
    [
      "Card",
      serializeCard(sampleCard, "https://api.teakvault.com", {
        backlinks: [],
        backlinksTruncated: false,
        links: [],
        linksTruncated: false,
      }),
    ],
    [
      "Folder",
      serializeFolder({
        _id: "folder_1",
        activeCardCount: 0,
        createdAt: 1,
        kind: "manual",
        name: "Reading",
        updatedAt: 1,
      }),
    ],
    [
      "FolderRuleRun",
      serializeFolderRuleRun({
        _id: "run_1",
        canUndo: true,
        createdAt: 1,
        filedCount: 0,
        folderId: "folder_1",
        status: "completed",
        taggedCount: 0,
      }),
    ],
    [
      "Highlight",
      serializeHighlight({
        _id: "highlight_1",
        cardId: "card_1",
        createdAt: 1,
        quote: "A line",
        source: "web",
        updatedAt: 1,
      }),
    ],
    [
      "TagOperation",
      serializeTagOperation({
        _id: testId("tagOperations", "op_1"),
        changed: 0,
        createdAt: 1,
        from: "old",
        kind: "rename",
        processed: 0,
        status: "running",
        total: 0,
        updatedAt: 1,
      }),
    ],
  ] as const)(
    "the %s schema documents every field the API sends, and no more",
    (schema, response) => {
      expect(documented(schema)).toEqual(sent(response));
    }
  );

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
});
