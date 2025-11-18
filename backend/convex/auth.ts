import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { Resend } from "@convex-dev/resend";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { Id } from "./_generated/dataModel";

const siteUrl = process.env.SITE_URL!;

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

export const resend = new Resend(components.resend, {
  testMode: false,
});

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  return betterAuth({
    // disable logging when createAuth is called just to generate options.
    // this is not required, but there's a lot of noise in logs without it.
    logger: {
      disabled: optionsOnly,
      level: "debug",
    },
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    // Configure simple, non-verified email/password to get started
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: "Reset your Password",
          html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true
      }
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex(),
    ],
  } satisfies BetterAuthOptions);
};

// Get the current user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    const storageId = getStorageIdFromImage(user.image);
    const imageUrl = storageId
      ? await ctx.storage.getUrl(storageId)
      : user.image ?? undefined;

    return {
      ...user,
      imageUrl,
      imageStorageId: storageId,
    };
  },
});

const STORAGE_PREFIX = "storage:";

const getStorageIdFromImage = (
  image?: string | null
): Id<"_storage"> | null => {
  if (!image || !image.startsWith(STORAGE_PREFIX)) return null;
  return image.slice(STORAGE_PREFIX.length) as Id<"_storage">;
};
