import { internal } from "@teak/convex/_generated/api";
import { type ConvexRpc, createConvexRpc } from "./convexRpc";
import type { BackgroundEnv } from "./workflows/runtime";

/**
 * Hourly rollup of the AI usage data points (aiUsage.ts `recordAiCall`) into
 * Convex's `aiUsageDaily`, which the admin console reads. It queries the
 * Workers Analytics Engine SQL API for today and yesterday (UTC), so the
 * first run after midnight finalizes yesterday, and writes each user's
 * absolute totals for the day: a repeated run sets the same numbers again.
 */

export interface AiUsageRollupEnv extends BackgroundEnv {
  /** The `AI_USAGE` binding's dataset name, which SQL queries by name. */
  AI_USAGE_DATASET?: string;
  /** The account whose Analytics Engine datasets the SQL API reads. */
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

/** Convex's `replaceDailyUsage` takes at most this many users per call. */
export const DAILY_USAGE_BATCH = 200;
/** One day's users per deployment; far above Teak's daily AI users. */
const MAX_USERS_PER_DAY = 50_000;
const DEFAULT_DATASET = "teak_ai_usage";
const SQL_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const utcDate = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);

const DATASET_PATTERN = /^[A-Za-z0-9_]+$/u;
const SQL_LITERAL_PATTERN = /^[A-Za-z0-9:/._-]+$/u;

/** The day's totals per user for one deployment, weighted for sampling. */
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
    "SELECT index1 AS userId,",
    "SUM(_sample_interval * double1) AS calls,",
    "SUM(_sample_interval * double2) AS errors,",
    "SUM(_sample_interval * double3) AS inputTokens,",
    "SUM(_sample_interval * double4) AS outputTokens,",
    "SUM(_sample_interval * double5) AS costUsd",
    `FROM ${dataset}`,
    `WHERE blob1 = '${convexSiteUrl}'`,
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

/** Rows from the SQL API's JSON reply; counts are rounded to whole calls. */
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

/**
 * Rolls up yesterday and today for one deployment. Returns null when the
 * SQL API is not configured (development, tests), else the users written.
 */
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
    for (let index = 0; index < rows.length; index += DAILY_USAGE_BATCH) {
      const result = await convex.mutation(
        internal.adminUsage.replaceDailyUsage,
        { date, rows: rows.slice(index, index + DAILY_USAGE_BATCH) }
      );
      written += result.written;
    }
  }
  return written;
};
