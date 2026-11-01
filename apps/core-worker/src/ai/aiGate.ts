import { internal } from "@teak/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { ConvexRpc } from "../convexRpc";

export type AiGate = FunctionReturnType<typeof internal.adminAccess.getAiGate>;
export type AiGateReader = (userId: string) => Promise<AiGate>;

export const AI_GATE_TTL_MS = 60_000;

const AI_GATE_CACHE_NAME = "ai-gate";
const AI_GATE_CACHE_PATH = "/__teak/ai-gate";
const MEMO_LIMIT = 1000;
const AI_GATES: ReadonlySet<string> = new Set<AiGate>([
  "allowed",
  "paused",
  "user_disabled",
]);

interface GateAnswer {
  gate: AiGate;
  readAt: number;
}

export type AiGateMemo = Map<string, GateAnswer>;

const isolateMemo: AiGateMemo = new Map();

const openEdgeCache = async (): Promise<Cache | null> => {
  if (typeof caches === "undefined") {
    return null;
  }
  try {
    return await caches.open(AI_GATE_CACHE_NAME);
  } catch {
    return null;
  }
};

const isFresh = (answer: GateAnswer, now: number) => {
  const age = now - answer.readAt;
  return age >= 0 && age < AI_GATE_TTL_MS;
};

const remember = (memo: AiGateMemo, key: string, answer: GateAnswer) => {
  memo.delete(key);
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) {
      memo.delete(oldest);
    }
  }
  memo.set(key, answer);
};

const edgeKey = (convexSiteUrl: string, userId: string): Request | null => {
  try {
    const url = new URL(AI_GATE_CACHE_PATH, convexSiteUrl);
    url.searchParams.set("user", userId);
    return new Request(url.toString(), { method: "GET" });
  } catch {
    return null;
  }
};

const readEdge = async (
  cache: Cache,
  key: Request,
  now: number
): Promise<GateAnswer | null> => {
  try {
    const response = await cache.match(key);
    if (!response) {
      return null;
    }
    const body = (await response.json()) as Partial<GateAnswer> | null;
    if (
      !(
        body &&
        typeof body.gate === "string" &&
        AI_GATES.has(body.gate) &&
        typeof body.readAt === "number"
      )
    ) {
      return null;
    }
    const answer = { gate: body.gate, readAt: body.readAt };
    return isFresh(answer, now) ? answer : null;
  } catch {
    return null;
  }
};

/**
 * Reads an account's AI gate at most once a minute per isolate and data
 * center: a memo in the isolate first, then the Cache API (local to the data
 * center), then Convex. Answers keep the time Convex gave them, so neither
 * layer serves one older than {@link AI_GATE_TTL_MS}. A cache that can't be
 * read or written is skipped; a Convex failure throws as it always has, and
 * nothing is remembered.
 */
export const createAiGateReader =
  (
    convex: ConvexRpc,
    convexSiteUrl: string,
    {
      cache = openEdgeCache,
      memo = isolateMemo,
      now = Date.now,
    }: {
      cache?: () => Promise<Cache | null>;
      memo?: AiGateMemo;
      now?: () => number;
    } = {}
  ): AiGateReader =>
  async (userId) => {
    const memoKey = `${convexSiteUrl}\n${userId}`;
    const remembered = memo.get(memoKey);
    if (remembered && isFresh(remembered, now())) {
      return remembered.gate;
    }
    const key = edgeKey(convexSiteUrl, userId);
    const edge = key ? await cache() : null;
    const cached = edge && key ? await readEdge(edge, key, now()) : null;
    if (cached) {
      remember(memo, memoKey, cached);
      return cached.gate;
    }
    const gate = await convex.query(internal.adminAccess.getAiGate, {
      userId,
    });
    const answer: GateAnswer = { gate, readAt: now() };
    remember(memo, memoKey, answer);
    if (edge && key) {
      await edge
        .put(
          key,
          new Response(JSON.stringify(answer), {
            headers: {
              "Cache-Control": `max-age=${String(AI_GATE_TTL_MS / 1000)}`,
              "Content-Type": "application/json",
            },
          })
        )
        .catch(() => undefined);
    }
    return gate;
  };
