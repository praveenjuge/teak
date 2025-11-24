import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const generateUploadUrl = mutation({
  args: {
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    // Generate upload URL - Convex handles storage internally
    // File organization is managed through the cards table with userId
    const uploadUrl = await ctx.storage.generateUploadUrl();

    // Log upload request for debugging/monitoring (optional)
    console.log(
      `User ${user.subject} uploading file: ${args.fileName || "unknown"} (${args.fileType || "unknown type"})`
    );

    return uploadUrl;
  },
});