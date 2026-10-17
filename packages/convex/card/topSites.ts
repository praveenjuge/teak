import { v } from "convex/values";
import { query } from "../_generated/server";
import { getSessionUser } from "../securitySessions";
import { hostForDisplay } from "../shared/utils/urlHost";
import { keepVisible } from "./hiddenCards";
import { buildCardListQuery } from "./listQuery";
import { cardUrlHost } from "./searchPlanner";

const TOP_SITES_SCAN_LIMIT = 500;
const TOP_SITES_DEFAULT_LIMIT = 8;
const TOP_SITES_MAX_LIMIT = 20;

/**
 * The sites the user saves most, for `site:` suggestions: counted over
 * their most recent links, most saved first. `host` is what `site:` takes;
 * `label` is the host as people read it.
 */
export const listTopSites = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({ host: v.string(), label: v.string(), count: v.number() })
  ),
  handler: async (ctx, args) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return [];
    }
    const limit = Math.min(
      TOP_SITES_MAX_LIMIT,
      Math.max(1, Math.floor(args.limit ?? TOP_SITES_DEFAULT_LIMIT))
    );
    const links = await buildCardListQuery(ctx, {
      userId: user.teakUserId,
      types: ["link"],
    })
      .order("desc")
      .take(TOP_SITES_SCAN_LIMIT);
    const counts = new Map<string, number>();
    for (const card of keepVisible(links)) {
      const host = cardUrlHost(card);
      if (host) {
        counts.set(host, (counts.get(host) ?? 0) + 1);
      }
    }
    return Array.from(counts, ([host, count]) => ({
      host,
      label: hostForDisplay(host),
      count,
    }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
      .slice(0, limit);
  },
});
