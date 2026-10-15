import { v } from "convex/values";
import { action, env, internalMutation, query } from "./_generated/server";
import { ensureAdmin, readInternalUserIds } from "./adminAccess";
import {
  type CronHealth,
  cronHealth,
  DAY_MS,
  summarizeSignupDomains,
} from "./adminStats";
import { POSTHOG_PROJECT_ID, POSTHOG_UI_HOST } from "./shared/posthog";

// Operational health for the superadmin console: cron heartbeats, webhooks
// Teak could not apply, failing imports and exports, and signup abuse.

const HOUR_MS = 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

/** How often each cron is scheduled (crons.ts), in milliseconds. */
export const CRON_SCHEDULES: Record<string, number> = {
  "workos-event-catch-up": HOUR_MS,
  "cleanup-expired-idempotency": HOUR_MS,
  "cleanup-old-deleted-cards": DAY_MS,
  "cleanup-abandoned-import-uploads": HOUR_MS,
  "cleanup-stale-pending-card-uploads": HOUR_MS,
  "sweep-orphaned-objects": 7 * DAY_MS,
  "reap-stuck-workflows": 7 * DAY_MS,
  "ai-metadata-backfill": 6 * HOUR_MS,
  "cleanup-expired-exports": DAY_MS,
  "redrive-account-deletion": 5 * 60 * 1000,
  "admin-daily-snapshot": DAY_MS,
};

export const recordCronRun = internalMutation({
  args: {
    name: v.string(),
    phase: v.union(
      v.literal("started"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { name, phase, error }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("cronHeartbeats")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (phase === "started") {
      if (row) {
        await ctx.db.patch("cronHeartbeats", row._id, {
          lastStartedAt: now,
          lastStatus: "running",
        });
      } else {
        await ctx.db.insert("cronHeartbeats", {
          name,
          lastStartedAt: now,
          lastStatus: "running",
          consecutiveFailures: 0,
        });
      }
      return null;
    }
    if (!row) {
      return null;
    }
    await ctx.db.patch(
      "cronHeartbeats",
      row._id,
      phase === "succeeded"
        ? {
            lastStatus: "succeeded",
            lastFinishedAt: now,
            lastSucceededAt: now,
            lastError: undefined,
            consecutiveFailures: 0,
          }
        : {
            lastStatus: "failed",
            lastFinishedAt: now,
            lastError: error?.slice(0, MAX_ERROR_LENGTH),
            consecutiveFailures: row.consecutiveFailures + 1,
          }
    );
    return null;
  },
});

const DEAD_LETTER_LIMIT = 500;
const JOB_FAILURE_LIMIT = 500;
const SIGNUP_SCAN_LIMIT = 5000;
const HEALTH_WINDOW_DAYS = 7;

export const getHealth = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    const now = Date.now();
    const since = now - HEALTH_WINDOW_DAYS * DAY_MS;

    const heartbeats = await ctx.db.query("cronHeartbeats").take(100);
    const byName = new Map(heartbeats.map((row) => [row.name, row]));
    const crons: Array<{
      name: string;
      health: CronHealth;
      expectedEveryMs: number;
      lastStartedAt: number | null;
      lastSucceededAt: number | null;
      lastError: string | null;
      consecutiveFailures: number;
    }> = Object.entries(CRON_SCHEDULES).map(([name, expectedEveryMs]) => {
      const row = byName.get(name);
      return {
        name,
        health: cronHealth(row, expectedEveryMs, now),
        expectedEveryMs,
        lastStartedAt: row?.lastStartedAt ?? null,
        lastSucceededAt: row?.lastSucceededAt ?? null,
        lastError: row?.lastError ?? null,
        consecutiveFailures: row?.consecutiveFailures ?? 0,
      };
    });

    const deadLetters = await ctx.db
      .query("workosWebhookDeadLetters")
      .order("desc")
      .take(DEAD_LETTER_LIMIT);

    const failedImports = await ctx.db
      .query("importJobs")
      .withIndex("by_status_upload_expires", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(JOB_FAILURE_LIMIT);
    const failedExports = await ctx.db
      .query("exportJobs")
      .withIndex("by_status_expires", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(JOB_FAILURE_LIMIT);
    const recentFailures = <T extends { _creationTime: number }>(rows: T[]) =>
      rows.filter((row) => row._creationTime >= since);

    const internalIds = await readInternalUserIds(ctx);
    const signups = (
      await ctx.db
        .query("users")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
        .take(SIGNUP_SCAN_LIMIT)
    ).filter(
      (user) =>
        user.deletedAt === undefined && !internalIds.has(user.teakUserId)
    );

    return {
      generatedAt: now,
      crons,
      deadLetters: {
        total: deadLetters.length,
        lastWeek: deadLetters.filter((row) => row.receivedAt >= since).length,
        latest: deadLetters.slice(0, 10).map((row) => ({
          event: row.event,
          reason: row.reason,
          receivedAt: row.receivedAt,
        })),
      },
      jobs: {
        failedImports: recentFailures(failedImports).length,
        failedExports: recentFailures(failedExports).length,
      },
      signupDomains: summarizeSignupDomains(
        signups.map((user) => ({
          email: user.email,
          createdAt: user._creationTime,
        })),
        now
      ).slice(0, 25),
      signupsLastDay: signups.filter(
        (user) => user._creationTime >= now - DAY_MS
      ).length,
      signupsLastWeek: signups.length,
      isApproximate:
        signups.length === SIGNUP_SCAN_LIMIT ||
        deadLetters.length === DEAD_LETTER_LIMIT,
    };
  },
});

/* PostHog reads ----------------------------------------------------------- */

const runHogQl = async (apiKey: string, hogql: string) => {
  const response = await fetch(
    `${POSTHOG_UI_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query: hogql,
          // The "Internal / Test users" filters set on the project.
          filters: { filterTestAccounts: true },
        },
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`PostHog query failed with ${response.status}`);
  }
  const body = (await response.json()) as { results?: unknown[][] };
  return body.results ?? [];
};

/**
 * Product signals only PostHog sees: how often search finds nothing, and
 * which surfaces cards are saved from. Needs POSTHOG_QUERY_API_KEY.
 */
export const getProductSignals = action({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    const apiKey = env.POSTHOG_QUERY_API_KEY;
    if (!apiKey) {
      return { configured: false as const };
    }
    const [searchRows, sourceRows] = await Promise.all([
      runHogQl(
        apiKey,
        `SELECT count() AS searches, countIf(properties.zero_result = true) AS empty
         FROM events
         WHERE event = 'search_performed' AND timestamp > now() - INTERVAL 7 DAY`
      ),
      runHogQl(
        apiKey,
        `SELECT properties.source AS source, count() AS cards
         FROM events
         WHERE event = 'card_created' AND timestamp > now() - INTERVAL 7 DAY
         GROUP BY source
         ORDER BY cards DESC
         LIMIT 20`
      ),
    ]);
    const [searches, empty] = (searchRows[0] ?? [0, 0]) as [number, number];
    return {
      configured: true as const,
      fetchedAt: Date.now(),
      search: { searches: Number(searches), zeroResults: Number(empty) },
      cardsBySource: sourceRows.map(([source, cards]) => ({
        source: typeof source === "string" && source ? source : "unknown",
        cards: Number(cards),
      })),
    };
  },
});
