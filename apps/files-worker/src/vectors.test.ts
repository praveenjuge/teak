import { describe, expect, test } from "bun:test";
import {
  buildFilesOpSigningPayload,
  CARD_EMBEDDING_MODEL,
  FILES_PROTOCOL_VERSION,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";
import { type FilesOpsEnv, handleInternalOp } from "./ops";

const SECRET = "test-secret";
const NAMESPACE = "teak_user_a";
const vector = (seed: number) =>
  Array.from({ length: 768 }, (_, i) => (i === seed ? 1 : 0));

/** Workers AI and one Vectorize shard, recording what they were asked. */
const fakes = ({
  aiError,
  dimensions = 768,
}: {
  aiError?: unknown;
  dimensions?: number;
} = {}) => {
  const aiCalls: { args: { text: string[] }; model: string }[] = [];
  const upserts: unknown[][] = [];
  const deletes: string[][] = [];
  const queries: { options: unknown; vector: number[] }[] = [];
  const stored = new Map<string, { namespace: string }>([
    ["card_1", { namespace: NAMESPACE }],
    ["card_other", { namespace: "teak_user_b" }],
  ]);
  const env = {
    AI: {
      run: (model: string, args: { text: string[] }) => {
        aiCalls.push({ args, model });
        if (aiError) {
          return Promise.reject(aiError);
        }
        return Promise.resolve({
          data: args.text.map((_, i) =>
            Array.from({ length: dimensions }, (__, j) => (j === i ? 1 : 0))
          ),
          shape: [args.text.length, dimensions],
        });
      },
    },
    CARD_VECTORS_0: {
      deleteByIds: (ids: string[]) => {
        deletes.push(ids);
        return Promise.resolve({ mutationId: "m-delete" });
      },
      getByIds: (ids: string[]) =>
        Promise.resolve(
          ids
            .filter((id) => stored.has(id))
            .map((id) => ({
              id,
              namespace: stored.get(id)?.namespace,
              values: new Float32Array(vector(3)),
            }))
        ),
      query: (values: number[], options: unknown) => {
        queries.push({ options, vector: values });
        return Promise.resolve({
          count: 2,
          matches: [
            { id: "card_2", score: 0.81 },
            { id: "card_1", score: 0.42 },
          ],
        });
      },
      upsert: (vectors: unknown[]) => {
        upserts.push(vectors);
        return Promise.resolve({ mutationId: "m-upsert" });
      },
    },
    FILES_SIGNING_SECRET: SECRET,
  } as unknown as FilesOpsEnv;
  return { aiCalls, deletes, env, queries, upserts };
};

const runOp = async (
  env: FilesOpsEnv,
  op: string,
  params: Record<string, unknown>
) => {
  const body = JSON.stringify({ op, params, version: FILES_PROTOCOL_VERSION });
  const requestId = crypto.randomUUID();
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const response = await handleInternalOp(
    new Request("https://files.teakvault.com/__ops/v1", {
      body,
      headers: {
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": await hmacSha256Hex(
          SECRET,
          buildFilesOpSigningPayload({
            bodySha256: await sha256Hex(body),
            expiresAt,
            requestId,
          })
        ),
      },
      method: "POST",
    }),
    env
  );
  return {
    body: (await response.json()) as {
      data?: Record<string, unknown>;
      error?: { code: string; retryable: boolean };
    },
    status: response.status,
  };
};

describe("embed-upsert", () => {
  test("embeds each card with the document prompt and upserts it in the user's namespace", async () => {
    const { aiCalls, env, upserts } = fakes();
    const { body, status } = await runOp(env, "embed-upsert", {
      items: [
        { id: "card_1", text: "Teak\nA tropical hardwood" },
        { id: "card_2", text: `  ${"x".repeat(5000)}  ` },
      ],
      namespace: NAMESPACE,
      shard: 0,
    });

    expect(status).toBe(200);
    expect(body.data).toEqual({ mutationId: "m-upsert", upserted: 2 });
    expect(aiCalls).toEqual([
      {
        args: {
          text: [
            "title: none | text: Teak\nA tropical hardwood",
            // Cut to what EmbeddingGemma reads.
            `title: none | text: ${"x".repeat(1440)}`,
          ],
        },
        model: CARD_EMBEDDING_MODEL,
      },
    ]);
    expect(upserts).toEqual([
      [
        { id: "card_1", namespace: NAMESPACE, values: vector(0) },
        { id: "card_2", namespace: NAMESPACE, values: vector(1) },
      ],
    ]);
  });

  test("reports Workers AI capacity as AI_CAPACITY so Convex retries later", async () => {
    const { env, upserts } = fakes({
      aiError: Object.assign(new Error("Capacity temporarily exceeded"), {
        code: 3040,
      }),
    });
    const { body, status } = await runOp(env, "embed-upsert", {
      items: [{ id: "card_1", text: "Teak" }],
      namespace: NAMESPACE,
      shard: 0,
    });
    expect(status).toBe(429);
    expect(body.error?.code).toBe("AI_CAPACITY");
    expect(upserts).toEqual([]);
  });

  test("never upserts vectors of the wrong size", async () => {
    const { env, upserts } = fakes({ dimensions: 1024 });
    const { status } = await runOp(env, "embed-upsert", {
      items: [{ id: "card_1", text: "Teak" }],
      namespace: NAMESPACE,
      shard: 0,
    });
    expect(status).toBe(500);
    expect(upserts).toEqual([]);
  });

  test.each([
    ["no items", { items: [], namespace: NAMESPACE, shard: 0 }],
    [
      "33 items",
      {
        items: Array.from({ length: 33 }, (_, i) => ({
          id: `card_${i}`,
          text: "x",
        })),
        namespace: NAMESPACE,
        shard: 0,
      },
    ],
    [
      "a repeated id",
      {
        items: [
          { id: "card_1", text: "a" },
          { id: "card_1", text: "b" },
        ],
        namespace: NAMESPACE,
        shard: 0,
      },
    ],
    [
      "blank text",
      { items: [{ id: "card_1", text: "  " }], namespace: NAMESPACE, shard: 0 },
    ],
    [
      "a namespace over 64 bytes",
      {
        items: [{ id: "card_1", text: "a" }],
        namespace: "é".repeat(33),
        shard: 0,
      },
    ],
    [
      "a shard with no index",
      { items: [{ id: "card_1", text: "a" }], namespace: NAMESPACE, shard: 1 },
    ],
  ])("refuses %s", async (_label, params) => {
    const { aiCalls, env, upserts } = fakes();
    const { body, status } = await runOp(env, "embed-upsert", params);
    expect(status).toBe(400);
    expect(body.error?.code).toBe("INVALID_INPUT");
    expect(aiCalls).toEqual([]);
    expect(upserts).toEqual([]);
  });
});

describe("vector-delete, vector-get and vector-query", () => {
  test("deletes each id once", async () => {
    const { deletes, env } = fakes();
    const { body } = await runOp(env, "vector-delete", {
      ids: ["card_1", "card_2", "card_1"],
      shard: 0,
    });
    expect(body.data).toEqual({ mutationId: "m-delete" });
    expect(deletes).toEqual([["card_1", "card_2"]]);
  });

  test("reports which ids have a vector, and in which namespace", async () => {
    const { env } = fakes();
    const { body } = await runOp(env, "vector-get", {
      ids: ["card_1", "card_9"],
      shard: 0,
    });
    expect(body.data).toEqual({
      vectors: [{ id: "card_1", namespace: NAMESPACE }],
    });
  });

  test("embeds the query with the query prompt and searches only the user's namespace", async () => {
    const { aiCalls, env, queries } = fakes();
    const { body } = await runOp(env, "vector-query", {
      namespace: NAMESPACE,
      shard: 0,
      text: " wood for furniture ",
      topK: 20,
    });
    expect(aiCalls.map((call) => call.args.text)).toEqual([
      ["task: search result | query: wood for furniture"],
    ]);
    expect(queries).toEqual([
      {
        options: {
          namespace: NAMESPACE,
          returnMetadata: "none",
          returnValues: false,
          topK: 20,
        },
        vector: vector(0),
      },
    ]);
    expect(body.data).toEqual({
      matches: [
        { id: "card_2", score: 0.81 },
        { id: "card_1", score: 0.42 },
      ],
    });
  });

  test("searches with a card's own vector, leaving the card out", async () => {
    const { aiCalls, env, queries } = fakes();
    const { body } = await runOp(env, "vector-similar", {
      id: "card_1",
      namespace: NAMESPACE,
      shard: 0,
      topK: 1,
    });
    expect(aiCalls).toEqual([]);
    expect(queries).toEqual([
      {
        options: {
          namespace: NAMESPACE,
          returnMetadata: "none",
          returnValues: false,
          topK: 2,
        },
        vector: vector(3),
      },
    ]);
    expect(body.data).toEqual({
      found: true,
      matches: [{ id: "card_2", score: 0.81 }],
    });
  });

  test.each([
    ["card_9", NAMESPACE],
    ["card_other", NAMESPACE],
  ])(
    "finds nothing for %s without a vector in the namespace",
    async (id, namespace) => {
      const { env, queries } = fakes();
      const { body } = await runOp(env, "vector-similar", {
        id,
        namespace,
        shard: 0,
        topK: 10,
      });
      expect(body.data).toEqual({ found: false, matches: [] });
      expect(queries).toEqual([]);
    }
  );

  test.each([
    [
      "vector-delete",
      { ids: Array.from({ length: 1001 }, (_, i) => `c${i}`), shard: 0 },
    ],
    [
      "vector-get",
      { ids: Array.from({ length: 101 }, (_, i) => `c${i}`), shard: 0 },
    ],
    ["vector-get", { ids: ["x".repeat(65)], shard: 0 }],
    ["vector-query", { namespace: NAMESPACE, shard: 0, text: "a", topK: 101 }],
    ["vector-query", { shard: 0, text: "a", topK: 10 }],
    [
      "vector-query",
      { namespace: NAMESPACE, shard: 0, text: "a".repeat(501), topK: 10 },
    ],
    ["vector-similar", { namespace: NAMESPACE, shard: 0, topK: 10 }],
    [
      "vector-similar",
      { id: "card_1", namespace: NAMESPACE, shard: 0, topK: 101 },
    ],
  ])("%s refuses out-of-range params %#", async (op, params) => {
    const { env } = fakes();
    const { status } = await runOp(env, op, params);
    expect(status).toBe(400);
  });
});
