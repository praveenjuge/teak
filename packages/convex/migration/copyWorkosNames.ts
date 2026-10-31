import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { readComponentUser } from "../securitySessions";
import { workosDisplayName } from "../shared/workosIds";

// One-time copy of each owner's WorkOS name from the AuthKit component onto
// the users row, before the component goes. Run it until `isDone`:
// `bunx convex run --prod migration/copyWorkosNames:copyPage '{"paginationOpts":{"numItems":100,"cursor":null}}'`
export const copyPage = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    copied: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("users").paginate(paginationOpts);
    let copied = 0;
    for (const row of page.page) {
      if (!row.workosUserId || row.name !== undefined) {
        continue;
      }
      const user = await readComponentUser(ctx, row.workosUserId);
      const name = user
        ? workosDisplayName(user.name, user.firstName, user.lastName)
        : null;
      if (name) {
        await ctx.db.patch("users", row._id, { name });
        copied++;
      }
    }
    return {
      copied,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
