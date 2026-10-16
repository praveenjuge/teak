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
  type FilesVectorSimilarParams,
  type FilesVectorSimilarResult,
  isVectorCardType,
  VECTOR_ID_MAX_BYTES,
  VECTOR_NAMESPACE_MAX_BYTES,
  VECTOR_QUERY_MAX_CHARS,
  VECTOR_QUERY_MAX_TOP_K,
  VECTOR_TYPE_METADATA_KEY,
  vectorShardBinding,
} from "@teak/files-protocol";
import { aiRunOptions } from "./aiGateway";
import { meteredAiRun } from "./aiUsage";
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
    const { id, text, type } = (item ?? {}) as Record<string, unknown>;
    if (
      !isBoundedString(id, VECTOR_ID_MAX_BYTES) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > MAX_ITEM_TEXT_CHARS ||
      !(type === undefined || isVectorCardType(type))
    ) {
      throw new Error("invalid_embed_items");
    }
    return type === undefined ? { id, text } : { id, text, type };
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
  const { text, topK, type } = params;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > VECTOR_QUERY_MAX_CHARS ||
    !(type === undefined || isVectorCardType(type))
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
    ...(type === undefined ? {} : { type }),
  };
};

const parseTopK = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > VECTOR_QUERY_MAX_TOP_K
  ) {
    throw new Error("invalid_vector_query");
  }
  return value;
};

export const parseVectorSimilarParams = (
  params: Record<string, unknown>
): FilesVectorSimilarParams => {
  if (!isBoundedString(params.id, VECTOR_ID_MAX_BYTES)) {
    throw new Error("invalid_vector_ids");
  }
  return {
    id: params.id,
    namespace: parseNamespace(params.namespace),
    shard: parseShard(params.shard),
    topK: parseTopK(params.topK),
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
  const ai = env.AI;
  if (!ai) {
    throw new Error("ai_unavailable");
  }
  let response: unknown;
  try {
    response = await meteredAiRun(
      env,
      {
        functionId: "teak.ai.embedding",
        isCapacity: isCapacityError,
        model: CARD_EMBEDDING_MODEL,
      },
      () => ai.run(CARD_EMBEDDING_MODEL, { text: texts }, aiRunOptions(env))
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
      ...(item.type
        ? { metadata: { [VECTOR_TYPE_METADATA_KEY]: item.type } }
        : {}),
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

/**
 * The cards closest to one card, by its stored vector: no Workers AI call.
 * The vector must be in the caller's namespace, so one user can never search
 * with (or learn about) another user's card.
 */
export const vectorSimilar = async (
  env: FilesOpsEnv,
  { id, namespace, shard, topK }: FilesVectorSimilarParams
): Promise<FilesVectorSimilarResult> => {
  const index = indexForShard(env, shard);
  const [stored] = await index.getByIds([id]);
  const values = stored?.values ? Array.from(stored.values) : [];
  if (stored?.namespace !== namespace || values.length === 0) {
    return { found: false, matches: [] };
  }
  const result = await index.query(values, {
    namespace,
    returnMetadata: "none",
    returnValues: false,
    // The card itself is the closest match; ask for one more.
    topK: Math.min(topK + 1, VECTOR_QUERY_MAX_TOP_K),
  });
  return {
    found: true,
    matches: result.matches
      .filter((match) => match.id !== id)
      .slice(0, topK)
      .map((match) => ({ id: match.id, score: match.score })),
  };
};

const toMatches = (matches: VectorizeMatch[]) =>
  matches.map((match) => ({ id: match.id, score: match.score }));

/**
 * The cards closest to a search query. With `type`, only cards of that type,
 * so notes and links can't crowd a few images out of the top matches.
 * Vectors written before they carried a type never match the filter, so an
 * unfiltered query runs beside it and adds the untyped ones among its
 * matches; once every vector carries a type it adds nothing. An index without
 * the `type` metadata index may reject the filter, and none of its matches
 * read as typed: then the search runs as it did before types. A filter that
 * fails where vectors do carry types is a real failure.
 */
export const vectorQuery = async (
  env: FilesOpsEnv,
  { namespace, shard, text, topK, type }: FilesVectorQueryParams
): Promise<FilesVectorQueryResult> => {
  const index = indexForShard(env, shard);
  const [vector] = await embed(env, [cardEmbeddingQuery(text)]);
  const options = {
    namespace,
    // The typings accept a boolean, but the production API rejects one
    // ("returnMetadata: expected value", code 40026). "all" would also cap
    // topK at 50; "none" and "indexed" allow 100.
    returnMetadata: "none",
    returnValues: false,
    topK,
  } satisfies VectorizeQueryOptions;
  if (!type) {
    return {
      matches: toMatches(
        (await index.query(vector as number[], options)).matches
      ),
    };
  }
  const [typed, all] = await Promise.all([
    index
      .query(vector as number[], {
        ...options,
        filter: { [VECTOR_TYPE_METADATA_KEY]: type },
      })
      .then(
        (result) => result.matches,
        (error: unknown) => ({ error })
      ),
    index.query(vector as number[], { ...options, returnMetadata: "indexed" }),
  ]);
  const untyped = all.matches.filter(
    (match) => match.metadata?.[VECTOR_TYPE_METADATA_KEY] === undefined
  );
  let typedMatches: VectorizeMatch[] = [];
  if (Array.isArray(typed)) {
    typedMatches = typed;
  } else {
    if (untyped.length < all.matches.length) {
      throw typed.error;
    }
    console.warn("[files-worker] vector type filter failed", {
      message:
        typed.error instanceof Error ? typed.error.message.slice(0, 200) : "",
      shard,
    });
  }
  const typedIds = new Set(typedMatches.map((match) => match.id));
  return {
    matches: toMatches(
      [...typedMatches, ...untyped.filter((match) => !typedIds.has(match.id))]
        .sort((left, right) => right.score - left.score)
        .slice(0, topK)
    ),
  };
};
