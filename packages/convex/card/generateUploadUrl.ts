import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { isR2Configured, prepareR2Upload } from "../fileStorage";

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

    const uploadUrl = isR2Configured()
      ? (
          await prepareR2Upload({
            fileName: args.fileName,
            userId: user.subject,
          })
        ).uploadUrl
      : await ctx.storage.generateUploadUrl();

    // Log upload request for debugging/monitoring (optional)
    console.log(
      `User ${user.subject} uploading file: ${args.fileName || "unknown"} (${args.fileType || "unknown type"})`
    );

    return uploadUrl;
  },
});
