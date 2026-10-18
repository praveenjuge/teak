import type { convexTest } from "convex-test";

export const queuedObjectDeletions = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.query("workflowDispatches").collect()).flatMap((row) =>
      row.kind === "deleteObjects" ? (row.keys ?? []) : []
    )
  );
