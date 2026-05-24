import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { buildR2ObjectKey, r2 } from "../storage/r2";

export const generateUploadUrl = mutation({
  args: {
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
  },
  returns: v.object({
    key: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const upload = await r2.generateUploadUrl(
      buildR2ObjectKey({
        userId: user.subject,
        role: "file",
        fileName: args.fileName,
      })
    );

    console.log(
      `User ${user.subject} uploading R2 file: ${args.fileName || "unknown"} (${args.fileType || "unknown type"})`
    );

    return upload;
  },
});
