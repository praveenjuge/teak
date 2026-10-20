import { internal } from "@teak/convex/_generated/api";
import { MAX_DAILY_USAGE_ROWS } from "@teak/files-protocol";
import { type ConvexRpc, createConvexRpc } from "../convexRpc";
import type { BackgroundEnv } from "../workflows/runtime";
import { aiUsageColumn } from "./aiUsage";

export interface AiUsageRollupEnv extends BackgroundEnv {
  AI_USAGE_DATASET?: string;
  ANALYTICS_ACCOUNT_ID?: string;
  /** API token with Account Analytics: Read (a Wrangler secret). */
  ANALYTICS_API_TOKEN?: string;
}

export interface DailyUsageRow {
  calls: number;
  costUsd: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  userId: string;
}

const MAX_USERS_PER_DAY = 50_000;
const DEFAULT_DATASET = "teak_ai_usage";
const SQL_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const utcDate = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

const DAILY_USAGE_SUMS = [
  "calls",
  "errors",
  "inputTokens",
  "outputTokens",
  "costUsd",
] as const satisfies readonly (keyof DailyUsageRow)[];

const DATASET_PATTERN = /^[A-Za-z0-9_]+$/u;
const SQL_LITERAL_PATTERN = /^[A-Za-z0-9:/._-]+$/u;

export const dailyUsageSql = (
  dataset: string,
  convexSiteUrl: string,
  date: string
): string => {
  if (!DATASET_PATTERN.test(dataset)) {
    throw new Error("invalid_ai_usage_dataset");
  }
  if (
    !(
      SQL_LITERAL_PATTERN.test(convexSiteUrl) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(date)
    )
  ) {
    throw new Error("invalid_ai_usage_query");
  }
  const next = utcDate(Date.parse(`${date}T00:00:00Z`) + DAY_MS);
  return [
    "SELECT",
    [
      "index1 AS userId",
      ...DAILY_USAGE_SUMS.map(
        (name) => `SUM(_sample_interval * ${aiUsageColumn(name)}) AS ${name}`
      ),
    ].join(", "),
    `FROM ${dataset}`,
    `WHERE ${aiUsageColumn("convexSiteUrl")} = '${convexSiteUrl}'`,
    `AND timestamp >= toDateTime('${date} 00:00:00')`,
    `AND timestamp < toDateTime('${next} 00:00:00')`,
    "GROUP BY userId",
    `LIMIT ${MAX_USERS_PER_DAY}`,
    "FORMAT JSON",
  ].join(" ");
};

const nonNegative = (value: unknown): number => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : 0;
};

export const parseDailyUsage = (body: unknown): DailyUsageRow[] => {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error("ai_usage_sql_malformed");
  }
  return data.flatMap((row) => {
    const value = row as Record<string, unknown>;
    if (typeof value.userId !== "string" || !value.userId) {
      return [];
    }
    return [
      {
        calls: Math.round(nonNegative(value.calls)),
        costUsd: nonNegative(value.costUsd),
        errors: Math.round(nonNegative(value.errors)),
        inputTokens: Math.round(nonNegative(value.inputTokens)),
        outputTokens: Math.round(nonNegative(value.outputTokens)),
        userId: value.userId,
      },
    ];
  });
};

const queryDailyUsage = async (
  env: AiUsageRollupEnv,
  convexSiteUrl: string,
  date: string,
  fetcher: typeof fetch
): Promise<DailyUsageRow[]> => {
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${env.ANALYTICS_ACCOUNT_ID}/analytics_engine/sql`,
    {
      body: dailyUsageSql(
        env.AI_USAGE_DATASET || DEFAULT_DATASET,
        convexSiteUrl,
        date
      ),
      headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` },
      method: "POST",
      signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`ai_usage_sql_failed:${String(response.status)}`);
  }
  return parseDailyUsage(await response.json());
};

export interface AiUsageRollupDeps {
  convex?: ConvexRpc;
  fetcher?: typeof fetch;
  now?: number;
}

export const rollUpAiUsage = async (
  env: AiUsageRollupEnv,
  convexSiteUrl: string,
  deps: AiUsageRollupDeps = {}
): Promise<number | null> => {
  if (!(env.ANALYTICS_ACCOUNT_ID && env.ANALYTICS_API_TOKEN)) {
    console.log("[ai-usage] rollup skipped: SQL API not configured");
    return null;
  }
  const fetcher = deps.fetcher ?? fetch;
  const convex = deps.convex ?? createConvexRpc(env, convexSiteUrl);
  const now = deps.now ?? Date.now();
  let written = 0;
  for (const date of [utcDate(now - DAY_MS), utcDate(now)]) {
    const rows = await queryDailyUsage(env, convexSiteUrl, date, fetcher);
    for (let index = 0; index < rows.length; index += MAX_DAILY_USAGE_ROWS) {
      const result = await convex.mutation(
        internal.adminUsage.replaceDailyUsage,
        { date, rows: rows.slice(index, index + MAX_DAILY_USAGE_ROWS) }
      );
      written += result.written;
    }
  }
  return written;
};
