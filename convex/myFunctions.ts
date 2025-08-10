import { query } from "./_generated/server";

export const hello = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    const name = user?.name ?? user?.email ?? "Anonymous";
    return `Hello, ${name}! Welcome to your Next.js + Convex + Clerk app.`;
  },
});
