import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { expo } from '@better-auth/expo'
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth, BetterAuthOptions } from "better-auth";
import { Resend } from "@convex-dev/resend";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { Id } from "./_generated/dataModel";

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
    logger: {
      disabled: optionsOnly,
      level: "debug",
    },
    trustedOrigins: [
      siteUrl,
      "app.teakvault.com",
      "https://app.teakvault.com",
      "teakvault.com",
      "https://teakvault.com",
      "teak://",
      "http://localhost:3000",
      "exp://*",
      "exp://172.19.101.182:8081"
    ],
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: "Reset your Password",
          html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url, token }, request) => {
        await resend.sendEmail(requireActionCtx(ctx), {
          from: "Teak <hello@teakvault.com>",
          to: user.email,
          subject: 'Verify your email address',
          text: `Click the link to verify your email: ${url}`
        })
      }
    },
    user: {
      deleteUser: {
        enabled: true
      }
    },
    plugins: [
      expo(),
      // crossDomain({ siteUrl }),
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
