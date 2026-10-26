import { describe, expect, test } from "bun:test";
import { MAX_DAILY_USAGE_ROWS } from "@teak/files-protocol";
import { createConvexRpc } from "../convexRpc";
import {
  createFakeConvex,
  fakeConvexEnv,
  TEST_CONVEX_SITE_URL,
} from "../test/fakeConvex";
import {
  type AiUsageRollupEnv,
  dailyUsageSql,
  rollUpAiUsage,
} from "./aiUsageRollup";

const NOW = Date.parse("2026-10-16T00:15:00Z");

const env = (overrides: Partial<AiUsageRollupEnv> = {}) =>
  ({
    ...fakeConvexEnv,
    AI_USAGE_DATASET: "teak_ai_usage",
    ANALYTICS_ACCOUNT_ID: "account-1",
    ANALYTICS_API_TOKEN: "token-1",
    ...overrides,
  }) as AiUsageRollupEnv;

const sqlApi = (rowsByDate: Record<string, unknown[]>) => {
  const requests: Array<{
    authorization: string | null;
    sql: string;
    url: string;
  }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const sql = String(init?.body);
    requests.push({
      authorization: new Headers(init?.headers).get("authorization"),
      sql,
      url: String(input),
    });
    const date =
      /toDateTime\('(\d{4}-\d{2}-\d{2}) 00:00:00'\)/u.exec(sql)?.[1] ?? "";
    return Promise.resolve(
      Response.json({ data: rowsByDate[date] ?? [], meta: [], rows: 0 })
    );
  }) as typeof fetch;
  return { fetcher, requests };
};

const fakeConvex = () =>
  createFakeConvex({
    "adminUsage:replaceDailyUsage": (args) => ({
      written: (args.rows as unknown[]).length,
    }),
  });

describe("AI usage rollup", () => {
  test("writes yesterday's and today's absolute totals per user", async () => {
    const api = sqlApi({
      "2026-10-15": [
        {
          calls: 3,
          costUsd: 0.002,
          errors: 1,
          inputTokens: 300.000_000_1,
          outputTokens: 90,
          userId: "teak_a",
        },
      ],
      "2026-10-16": [
        {
          calls: "2",
          costUsd: "0.001",
          errors: 0,
          inputTokens: 20,
          outputTokens: 4,
          userId: "teak_b",
        },
        { calls: 1, userId: "" },
      ],
    });
    const convex = fakeConvex();
    const written = await rollUpAiUsage(env(), TEST_CONVEX_SITE_URL, {
      convex: createConvexRpc(
        fakeConvexEnv,
        TEST_CONVEX_SITE_URL,
        convex.fetcher
      ),
      fetcher: api.fetcher,
      now: NOW,
    });
    expect(written).toBe(2);
    expect(api.requests.map((request) => request.url)).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/account-1/analytics_engine/sql",
      "https://api.cloudflare.com/client/v4/accounts/account-1/analytics_engine/sql",
    ]);
    expect(api.requests[0]?.authorization).toBe("Bearer token-1");
    expect(
      convex.callsTo("adminUsage:replaceDailyUsage").map((call) => call.args)
    ).toEqual([
      {
        date: "2026-10-15",
        rows: [
          {
            calls: 3,
            costUsd: 0.002,
            errors: 1,
            inputTokens: 300,
            outputTokens: 90,
            userId: "teak_a",
          },
        ],
      },
      {
        date: "2026-10-16",
        rows: [
          {
            calls: 2,
            costUsd: 0.001,
            errors: 0,
            inputTokens: 20,
            outputTokens: 4,
            userId: "teak_b",
          },
        ],
      },
    ]);
  });

  test("queries one deployment's points for one UTC day, weighted for sampling", () => {
    const sql = dailyUsageSql(
      "teak_ai_usage",
      TEST_CONVEX_SITE_URL,
      "2026-12-31"
    );
    expect(sql).toContain("FROM teak_ai_usage");
    expect(sql).toContain(`blob1 = '${TEST_CONVEX_SITE_URL}'`);
    expect(sql).toContain("timestamp >= toDateTime('2026-12-31 00:00:00')");
    expect(sql).toContain("timestamp < toDateTime('2027-01-01 00:00:00')");
    expect(sql).toContain("SUM(_sample_interval * double1) AS calls");
    expect(() =>
      dailyUsageSql(
        "teak_ai_usage",
        "https://x.convex.site' OR '1'='1",
        "2026-12-31"
      )
    ).toThrow("invalid_ai_usage_query");
    expect(() =>
      dailyUsageSql("teak; DROP", TEST_CONVEX_SITE_URL, "2026-12-31")
    ).toThrow("invalid_ai_usage_dataset");
  });

  test("sends a busy day in bounded batches", async () => {
    const rows = Array.from(
      { length: MAX_DAILY_USAGE_ROWS + 1 },
      (_, index) => ({
        calls: 1,
        userId: `teak_${String(index)}`,
      })
    );
    const api = sqlApi({ "2026-10-16": rows });
    const convex = fakeConvex();
    await rollUpAiUsage(env(), TEST_CONVEX_SITE_URL, {
      convex: createConvexRpc(
        fakeConvexEnv,
        TEST_CONVEX_SITE_URL,
        convex.fetcher
      ),
      fetcher: api.fetcher,
      now: NOW,
    });
    expect(
      convex
        .callsTo("adminUsage:replaceDailyUsage")
        .map((call) => (call.args.rows as unknown[]).length)
    ).toEqual([MAX_DAILY_USAGE_ROWS, 1]);
  });

  test("is skipped without the SQL API token", async () => {
    const api = sqlApi({});
    expect(
      await rollUpAiUsage(
        env({ ANALYTICS_API_TOKEN: undefined }),
        TEST_CONVEX_SITE_URL,
        {
          fetcher: api.fetcher,
          now: NOW,
        }
      )
    ).toBeNull();
    expect(api.requests).toEqual([]);
  });

  test("retries the SQL API's server errors before giving up", async () => {
    const api = sqlApi({
      "2026-10-15": [{ calls: 2, costUsd: 0.5, userId: "user_a" }],
    });
    const statuses = [500, 503];
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => {
      const status = statuses.shift();
      return status
        ? Promise.resolve(new Response("busy", { status }))
        : api.fetcher(input, init);
    }) as typeof fetch;
    const convex = fakeConvex();
    const rpc = createConvexRpc(
      fakeConvexEnv,
      TEST_CONVEX_SITE_URL,
      convex.fetcher
    );
    expect(
      await rollUpAiUsage(env(), TEST_CONVEX_SITE_URL, {
        convex: rpc,
        fetcher: flaky,
        now: NOW,
        sqlRetryDelayMs: 0,
      })
    ).toBe(1);

    let calls = 0;
    await expect(
      rollUpAiUsage(env(), TEST_CONVEX_SITE_URL, {
        convex: rpc,
        fetcher: (() => {
          calls += 1;
          return Promise.resolve(new Response("down", { status: 500 }));
        }) as unknown as typeof fetch,
        now: NOW,
        sqlRetryDelayMs: 0,
      })
    ).rejects.toThrow("ai_usage_sql_failed:500");
    expect(calls).toBe(3);
  });

  test("fails without writing when the SQL API refuses", async () => {
    const convex = fakeConvex();
    let refusals = 0;
    await expect(
      rollUpAiUsage(env(), TEST_CONVEX_SITE_URL, {
        convex: createConvexRpc(
          fakeConvexEnv,
          TEST_CONVEX_SITE_URL,
          convex.fetcher
        ),
        fetcher: (() => {
          refusals += 1;
          return Promise.resolve(new Response("denied", { status: 403 }));
        }) as unknown as typeof fetch,
        now: NOW,
      })
    ).rejects.toThrow("ai_usage_sql_failed:403");
    expect(refusals).toBe(1);
    expect(convex.calls).toEqual([]);
  });
});
