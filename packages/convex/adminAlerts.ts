import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalAction, type MutationCtx } from "./_generated/server";

export const scheduleAdminAlert = async (ctx: MutationCtx, text: string) => {
  if (!env.ADMIN_ALERT_WEBHOOK_URL) {
    return;
  }
  await ctx.scheduler.runAfter(0, internal.adminAlerts.sendAdminAlert, {
    text,
  });
};

export const sendAdminAlert = internalAction({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (_ctx, { text }) => {
    const url = env.ADMIN_ALERT_WEBHOOK_URL;
    if (!url) {
      return null;
    }
    // Slack reads `text`, Discord reads `content`; each ignores the other.
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text }),
    });
    if (!response.ok) {
      throw new Error(`Admin alert webhook failed with ${response.status}`);
    }
    return null;
  },
});
