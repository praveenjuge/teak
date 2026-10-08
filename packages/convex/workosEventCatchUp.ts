import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { createWorkosClient } from "./shared/workosClient";
import { authKit } from "./workosAuthKit";
import { ingestWorkosEvent } from "./workosWebhook";

// WorkOS retries webhooks for a while, then gives up. This replays user events
// from the Events API through the same ingest as the webhook, so a missed
// delivery still reaches both the component and Teak. Already applied events
// are skipped by their event ID.

const CURSOR = "user-events";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
// The first run looks back one day; later runs continue from the last event.
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
    const existing = await ctx.db
      .query("workosEventCursors")
      .withIndex("by_name", (q) => q.eq("name", CURSOR))
      .unique();
    if (existing) {
      await ctx.db.patch("workosEventCursors", existing._id, {
        after,
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
      // A failure throws before the cursor moves, so the next run retries it.
      const outcome = await ingestWorkosEvent(ctx, event);
      if (outcome === "rejected") {
        rejected += 1;
      } else {
        applied += 1;
      }
      after = event.id;
      await ctx.runMutation(internal.workosEventCatchUp.saveCursor, { after });
    }
    if (!result.listMetadata.after || result.data.length === 0) {
      break;
    }
  }
  return { applied, rejected };
};
