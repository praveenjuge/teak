import { WorkerEntrypoint } from "cloudflare:workers";
import { CARD_EMBEDDING_DIMENSIONS } from "@teak/files-protocol";

const STOP_WORDS = new Set(
  "about after again also analyze and are because been being content could does each from generate have into just like more most other over page some summary tags than that their them then there these they this those through title very what when where which while will with would your".split(
    " "
  )
);

interface Fields {
  [key: string]: unknown;
}

const asFields = (value: unknown): Fields =>
  typeof value === "object" && value !== null ? (value as Fields) : {};

const messagesOf = (inputs: Record<string, unknown>): Fields[] =>
  Array.isArray(inputs.messages) ? inputs.messages.map(asFields) : [];

const userText = (inputs: Record<string, unknown>): string => {
  const content = messagesOf(inputs)
    .reverse()
    .find((message) => message.role === "user")?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const { text } = asFields(part);
        return typeof text === "string" ? text : "";
      })
      .join(" ");
  }
  return "";
};

const hasImage = (inputs: Record<string, unknown>): boolean =>
  JSON.stringify(inputs.messages ?? "").includes('"image_url"');

const readsTextOnly = (inputs: Record<string, unknown>): boolean => {
  const content = messagesOf(inputs).find(
    (message) => message.role === "system"
  )?.content;
  const prompt = typeof content === "string" ? content : "";
  return prompt.includes('{"text": "..."}') && !prompt.includes('"tags"');
};

const tagsFor = (text: string): string[] => {
  const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/gu) ?? [];
  const tags: string[] = [];
  for (const word of words) {
    if (!(STOP_WORDS.has(word) || tags.includes(word))) {
      tags.push(word);
    }
    if (tags.length === 4) {
      break;
    }
  }
  return tags.length > 0 ? tags : ["note"];
};

const summaryFor = (text: string): string => {
  const body = text
    .replace(/^[\s\S]*?(?:Content:|summary:)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return body
    ? `Saved note about ${body.slice(0, 120)}${body.length > 120 ? "…" : ""}`
    : "A saved note.";
};

const embeddingFor = (text: string): number[] => {
  const vector = new Array<number>(CARD_EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/gu) ?? []) {
    let hash = 0;
    for (const char of word) {
      hash = (hash * 31 + char.charCodeAt(0)) % CARD_EMBEDDING_DIMENSIONS;
    }
    vector[hash] = (vector[hash] ?? 0) + 1;
  }
  vector[0] = (vector[0] ?? 0) + 0.01;
  return vector;
};

const chatReply = (content: unknown, text: string) => ({
  choices: [{ message: { content: JSON.stringify(content) } }],
  usage: {
    completion_tokens: 40,
    prompt_tokens: Math.max(1, Math.ceil(text.length / 4)),
  },
});

export default class FakeWorkersAi extends WorkerEntrypoint {
  run(model: string, inputs: Record<string, unknown>): unknown {
    if (model.includes("whisper")) {
      return { text: "A short spoken note recorded for the local test." };
    }
    if (model.includes("bge") || model.includes("embedding")) {
      const texts = Array.isArray(inputs.text) ? inputs.text : [inputs.text];
      return {
        data: texts.map((text) => embeddingFor(String(text ?? ""))),
        shape: [texts.length, CARD_EMBEDDING_DIMENSIONS],
      };
    }
    const text = userText(inputs);
    if (hasImage(inputs) && readsTextOnly(inputs)) {
      return chatReply({ text: "" }, text);
    }
    if (hasImage(inputs)) {
      return chatReply(
        {
          language: "en",
          summary: "A photo analyzed by the local test model.",
          tags: ["photo", "local-test"],
        },
        text
      );
    }
    // Its summaries are English, whatever the note's language.
    return chatReply(
      { language: "en", summary: summaryFor(text), tags: tagsFor(text) },
      text
    );
  }

  fetch(): Response {
    return new Response("Fake Workers AI for the local E2E stack.");
  }
}

interface StoredVector {
  id: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
  values: number[];
}

const vectors = new Map<string, StoredVector>();

const cosine = (left: number[], right: number[]): number => {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};

/**
 * Stands in for a Vectorize index (`CARD_VECTORS_0`) in the local E2E stack,
 * which Wrangler can only reach remotely: the binding is a service binding to
 * this entrypoint, and the Core Worker's `upsert`, `query`, `getByIds` and
 * `deleteByIds` calls reach it over RPC. Vectors live in memory and queries
 * rank by cosine similarity within a namespace.
 */
export class FakeVectorize extends WorkerEntrypoint {
  upsert(items: StoredVector[]) {
    for (const item of items) {
      vectors.set(item.id, {
        id: item.id,
        ...(item.metadata ? { metadata: { ...item.metadata } } : {}),
        namespace: item.namespace,
        values: Array.from(item.values),
      });
    }
    return {
      count: items.length,
      ids: items.map((item) => item.id),
      mutationId: crypto.randomUUID(),
    };
  }

  deleteByIds(ids: string[]) {
    for (const id of ids) {
      vectors.delete(id);
    }
    return { count: ids.length, ids, mutationId: crypto.randomUUID() };
  }

  getByIds(ids: string[]) {
    return ids.flatMap((id) => {
      const vector = vectors.get(id);
      return vector ? [vector] : [];
    });
  }

  query(
    values: number[],
    options: {
      filter?: Record<string, unknown>;
      namespace?: string;
      returnMetadata?: string;
      topK?: number;
    } = {}
  ) {
    const matches = [...vectors.values()]
      .filter(
        (vector) =>
          vector.namespace === options.namespace &&
          Object.entries(options.filter ?? {}).every(
            ([key, value]) => vector.metadata?.[key] === value
          )
      )
      .map((vector) => ({
        id: vector.id,
        ...(options.returnMetadata && options.returnMetadata !== "none"
          ? { metadata: vector.metadata ?? {} }
          : {}),
        score: cosine(values, vector.values),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, options.topK ?? 5);
    return { count: matches.length, matches };
  }
}

export { FakeLinkFetcher } from "./fakeLinkFetcher";
