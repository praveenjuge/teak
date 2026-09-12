import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/** Bind once before storing any rows, including across action retries. */
export const bind = internalMutation({
  args: { jobId: v.id("importJobs"), sourceEtag: v.string() },
  returns: v.string(),
  handler: async (ctx, { jobId, sourceEtag }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("missing_job");
    }
    if (!sourceEtag || sourceEtag.length > 255) {
      throw new Error("invalid_source_etag");
    }
    if (job.sourceEtag && job.sourceEtag !== sourceEtag) {
      throw new Error("source_changed");
    }
    if (!job.sourceEtag) {
      await ctx.db.patch(jobId, { sourceEtag });
    }
    return sourceEtag;
  },
});
