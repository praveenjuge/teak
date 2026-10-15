import {
  CARD_EMBEDDING_DIMENSIONS,
  CARD_EMBEDDING_MODEL,
  cardEmbeddingDocument,
  cardEmbeddingQuery,
  EMBED_UPSERT_MAX_ITEMS,
  type FilesEmbedUpsertParams,
  type FilesEmbedUpsertResult,
  type FilesVectorDeleteParams,
  type FilesVectorDeleteResult,
  type FilesVectorGetParams,
  type FilesVectorGetResult,
  type FilesVectorQueryParams,
  type FilesVectorQueryResult,
  VECTOR_ID_MAX_BYTES,
  VECTOR_NAMESPACE_MAX_BYTES,
  VECTOR_QUERY_MAX_CHARS,
  VECTOR_QUERY_MAX_TOP_K,
  vectorShardBinding,
} from "@teak/files-protocol";
import { aiRunOptions } from "./aiGateway";
import type { FilesOpsEnv } from "./ops";
import { isCapacityError, MetadataCapacityError } from "./textMetadata";

const MAX_ITEM_TEXT_CHARS = 20_000;

const byteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;

const isBoundedString = (value: unknown, maxBytes: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  byteLength(value) <= maxBytes;

const parseShard = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("invalid_vector_shard");
  }
  return value;
};

const parseNamespace = (value: unknown): string => {
  if (!isBoundedString(value, VECTOR_NAMESPACE_MAX_BYTES)) {
    throw new Error("invalid_vector_namespace");
  }
  return value;
};

const parseIds = (value: unknown, max: number): string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > max ||
    !value.every((id) => isBoundedString(id, VECTOR_ID_MAX_BYTES))
  ) {
    throw new Error("invalid_vector_ids");
  }
  return Array.from(new Set(value as string[]));
};

export const parseEmbedUpsertParams = (
  params: Record<string, unknown>
): FilesEmbedUpsertParams => {
  const { items } = params;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > EMBED_UPSERT_MAX_ITEMS
  ) {
    throw new Error("invalid_embed_items");
  }
  const parsed = items.map((item) => {
    const { id, text } = (item ?? {}) as Record<string, unknown>;
    if (
      !isBoundedString(id, VECTOR_ID_MAX_BYTES) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > MAX_ITEM_TEXT_CHARS
    ) {
      throw new Error("invalid_embed_items");
    }
    return { id, text };
  });
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new Error("invalid_embed_items");
  }
  return {
    items: parsed,
    namespace: parseNamespace(params.namespace),
    shard: parseShard(params.shard),
  };
};

export const parseVectorIdsParams = (
  params: Record<string, unknown>,
  max: number
): { ids: string[]; shard: number } => ({
  ids: parseIds(params.ids, max),
  shard: parseShard(params.shard),
});

export const parseVectorQueryParams = (
  params: Record<string, unknown>
): FilesVectorQueryParams => {
  const { text, topK } = params;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > VECTOR_QUERY_MAX_CHARS
  ) {
    throw new Error("invalid_vector_query");
  }
  if (
    typeof topK !== "number" ||
    !Number.isInteger(topK) ||
    topK < 1 ||
    topK > VECTOR_QUERY_MAX_TOP_K
  ) {
    throw new Error("invalid_vector_query");
  }
  return {
    namespace: parseNamespace(params.namespace),
    shard: parseShard(params.shard),
    text,
    topK,
  };
};

const indexForShard = (env: FilesOpsEnv, shard: number): Vectorize => {
  const index = (env as unknown as Record<string, Vectorize | undefined>)[
    vectorShardBinding(shard)
  ];
  if (!index) {
    throw new Error("invalid_vector_shard");
  }
  return index;
};

const embed = async (env: FilesOpsEnv, texts: string[]) => {
  if (!env.AI) {
    throw new Error("ai_unavailable");
  }
  let response: unknown;
  try {
    response = await env.AI.run(
      CARD_EMBEDDING_MODEL,
      { text: texts },
      aiRunOptions(env)
    );
  } catch (error) {
    if (isCapacityError(error)) {
      throw new MetadataCapacityError({ validationRetryCount: 0 });
    }
    throw error;
  }
  const data = (response as { data?: unknown } | null)?.data;
  if (
    !Array.isArray(data) ||
    data.length !== texts.length ||
    !data.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === CARD_EMBEDDING_DIMENSIONS &&
        vector.every((value) => typeof value === "number")
    )
  ) {
    throw new Error("embedding_output_invalid");
  }
  return data as number[][];
};

export const embedUpsert = async (
  env: FilesOpsEnv,
  { items, namespace, shard }: FilesEmbedUpsertParams
): Promise<FilesEmbedUpsertResult> => {
  const index = indexForShard(env, shard);
  const vectors = await embed(
    env,
    items.map((item) => cardEmbeddingDocument(item.text))
  );
  const mutation = await index.upsert(
    items.map((item, i) => ({
      id: item.id,
      namespace,
      values: vectors[i] as number[],
    }))
  );
  return { mutationId: mutation.mutationId, upserted: items.length };
};

export const vectorDelete = async (
  env: FilesOpsEnv,
  { ids, shard }: FilesVectorDeleteParams
): Promise<FilesVectorDeleteResult> => {
  const mutation = await indexForShard(env, shard).deleteByIds(ids);
  return { mutationId: mutation.mutationId };
};

export const vectorGet = async (
  env: FilesOpsEnv,
  { ids, shard }: FilesVectorGetParams
): Promise<FilesVectorGetResult> => {
  const found = await indexForShard(env, shard).getByIds(ids);
  return {
    vectors: found.map((vector) => ({
      id: vector.id,
      namespace: vector.namespace ?? null,
    })),
  };
};

export const vectorQuery = async (
  env: FilesOpsEnv,
  { namespace, shard, text, topK }: FilesVectorQueryParams
): Promise<FilesVectorQueryResult> => {
  const index = indexForShard(env, shard);
  const [vector] = await embed(env, [cardEmbeddingQuery(text)]);
  const result = await index.query(vector as number[], {
    namespace,
    // The typings accept a boolean, but the production API rejects one
    // ("returnMetadata: expected value", code 40026).
    returnMetadata: "none",
    returnValues: false,
    topK,
  });
  return {
    matches: result.matches.map((match) => ({
      id: match.id,
      score: match.score,
    })),
  };
};
