import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { createWorkosClient } from "./shared/workosClient";
import { captureBackendException } from "./telemetry/posthog";
import { authKit } from "./workosAuthKit";
import { ingestWorkosEvent } from "./workosWebhook";

// WorkOS retries webhooks for a while, then gives up, so a missed delivery is
// replayed from the Events API.

const CURSOR = "user-events";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Runs an event may fail before it is dead-lettered, so one bad event can't
// hold every later one back.
const MAX_EVENT_ATTEMPTS = 5;

const cursorRow = (ctx: MutationCtx) =>
  ctx.db
    .query("workosEventCursors")
    .withIndex("by_name", (q) => q.eq("name", CURSOR))
    .unique();

export const readCursor = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("workosEventCursors")
        .withIndex("by_name", (q) => q.eq("name", CURSOR))
        .unique()
    )?.after ?? null,
});

export const saveCursor = internalMutation({
  args: { after: v.string() },
  returns: v.null(),
  handler: async (ctx, { after }) => {
    const existing = await cursorRow(ctx);
    if (existing) {
      await ctx.db.patch("workosEventCursors", existing._id, {
        after,
        failingEventId: undefined,
        failedAttempts: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("workosEventCursors", {
        name: CURSOR,
        after,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Counts a run that failed on `eventId` and returns how many have. */
export const recordFailedAttempt = internalMutation({
  args: { eventId: v.string() },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    const existing = await cursorRow(ctx);
    const failedAttempts =
      existing?.failingEventId === eventId
        ? (existing.failedAttempts ?? 0) + 1
        : 1;
    const fields = { failingEventId: eventId, failedAttempts };
    if (existing) {
      await ctx.db.patch("workosEventCursors", existing._id, {
        ...fields,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("workosEventCursors", {
        name: CURSOR,
        ...fields,
        updatedAt: Date.now(),
      });
    }
    return failedAttempts;
  },
});

const ingestOrDeadLetter = async (
  ctx: Pick<ActionCtx, "runMutation">,
  event: Parameters<typeof ingestWorkosEvent>[1] & { id: string },
  saveProgress: () => Promise<void>
): Promise<"applied" | "rejected"> => {
  try {
    return await ingestWorkosEvent(ctx, event);
  } catch (error) {
    // Saving the cursor clears the failure count, so it must come first.
    await saveProgress();
    const attempts = await ctx.runMutation(
      internal.workosEventCatchUp.recordFailedAttempt,
      { eventId: event.id }
    );
    if (attempts < MAX_EVENT_ATTEMPTS) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.workosWebhook.recordDeadLetter, {
      eventId: event.id.slice(0, 256),
      event: event.event,
      reason: `catch_up_failed: ${message}`.slice(0, 128),
    });
    await captureBackendException(error, {
      properties: {
        attempts,
        event: event.event,
        operation: "workos_event_catch_up",
        stage: "dead_letter",
      },
    });
    return "rejected";
  }
};

export const catchUpHandler = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">
) => {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!(authKit && apiKey)) {
    return { applied: 0, rejected: 0 };
  }
  const workos = createWorkosClient(apiKey, process.env.WORKOS_CLIENT_ID);
  let after: string | null = await ctx.runQuery(
    internal.workosEventCatchUp.readCursor,
    {}
  );
  let applied = 0;
  let rejected = 0;
  let saved = after;
  // One cursor write per page, plus one before a failing event so the
  // progress made before it is kept.
  const saveProgress = async () => {
    if (after !== null && after !== saved) {
      await ctx.runMutation(internal.workosEventCatchUp.saveCursor, { after });
      saved = after;
    }
  };
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await workos.events.listEvents({
      events: ["user.created", "user.updated", "user.deleted"],
      limit: PAGE_SIZE,
      order: "asc",
      ...(after
        ? { after }
        : {
            rangeStart: new Date(Date.now() - FIRST_LOOKBACK_MS).toISOString(),
          }),
    });
    for (const event of result.data) {
      if (
        event.event !== "user.created" &&
        event.event !== "user.updated" &&
        event.event !== "user.deleted"
      ) {
        continue;
      }
      const outcome = await ingestOrDeadLetter(ctx, event, saveProgress);
      if (outcome === "rejected") {
        rejected += 1;
      } else {
        applied += 1;
      }
      after = event.id;
    }
    await saveProgress();
    if (!result.listMetadata.after || result.data.length === 0) {
      break;
    }
  }
  return { applied, rejected };
};
