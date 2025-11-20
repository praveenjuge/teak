import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { expo } from '@better-auth/expo'
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { Resend } from "@convex-dev/resend";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { extractStorageId } from "../shared/utils/storageUtils";

const siteUrl = process.env.SITE_URL!;
export const REGISTRATION_CLOSED_MESSAGE = "Registration is currently closed";

const isMultipleUserRegistrationEnabled = () => {
  const raw = process.env.ENABLE_MULTIPLE_USER_REGISTRATION;
  if (!raw) return false;
  return raw.trim().toLowerCase() === "true";
};

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
    trustedOrigins: [
      siteUrl,
      "teak://",
      "http://localhost:3000",
      "exp://*"
    ],
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
      expo(),
      crossDomain({ siteUrl }),
      // The Convex plugin is required for Convex compatibility
      convex(),
    ],
  } satisfies BetterAuthOptions);
};

export const canRegisterNewUser = query({
  args: {},
  handler: async (ctx) => {
    const multipleRegistrationsEnabled = isMultipleUserRegistrationEnabled();
    const existingUsers = await ctx.runQuery(
      authComponent.component.adapter.findMany,
      {
        model: "user",
        limit: 1,
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
      }
    );
    const hasAnyUser = Array.isArray(existingUsers?.page)
      ? existingUsers.page.length > 0
      : Array.isArray(existingUsers)
        ? existingUsers.length > 0
        : false;
    const allowed = multipleRegistrationsEnabled || !hasAnyUser;

    return {
      allowed,
      message: allowed ? null : REGISTRATION_CLOSED_MESSAGE,
      hasAnyUser,
      multipleRegistrationsEnabled,
    };
  },
});

// Get the current user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return null;

    const storageId = extractStorageId(user.image);
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
