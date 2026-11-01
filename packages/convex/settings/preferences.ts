import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type Locale,
} from "@teak/i18n/locales";
import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";
import { getSessionUser, requireSessionUser } from "../securitySessions";

// Account display preferences. The language is chosen in Settings; the public
// API reads it (`/v1/me`) but has no setter (scripts/repo/public-parity.ts).

export const UNSUPPORTED_LOCALE_ERROR = {
  code: "UNSUPPORTED_LOCALE",
  message: "That language isn't available.",
} as const;

const preferencesValidator = v.object({ locale: v.string() });

const readPreferencesRow = (ctx: QueryCtx | MutationCtx, userId: string) =>
  ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

/**
 * The account's UI language. No row, or a code this deployment doesn't
 * support (say, one a later release removed), reads as English.
 */
export const readAccountLocale = async (
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Locale> => {
  const stored = (await readPreferencesRow(ctx, userId))?.locale;
  return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
};

/** Saves the account's language; writes nothing when it's unchanged. */
export const writeAccountLocale = async (
  ctx: MutationCtx,
  userId: string,
  locale: Locale
) => {
  const existing = await readPreferencesRow(ctx, userId);
  if (existing) {
    if (existing.locale !== locale) {
      await ctx.db.patch("userPreferences", existing._id, {
        locale,
        updatedAt: Date.now(),
      });
    }
    return;
  }
  await ctx.db.insert("userPreferences", {
    userId,
    locale,
    updatedAt: Date.now(),
  });
};

/** The signed-in account's preferences, or null when signed out. */
export const getPreferences = query({
  args: {},
  returns: v.union(v.null(), preferencesValidator),
  handler: async (ctx) => {
    const session = await getSessionUser(ctx);
    if (!session) {
      return null;
    }
    return { locale: await readAccountLocale(ctx, session.teakUserId) };
  },
});

export const setLocale = mutation({
  args: { locale: v.string() },
  returns: preferencesValidator,
  handler: async (ctx, { locale }) => {
    const { teakUserId: userId } = await requireSessionUser(ctx);
    if (!isSupportedLocale(locale)) {
      throw new ConvexError(UNSUPPORTED_LOCALE_ERROR);
    }
    await writeAccountLocale(ctx, userId, locale);
    return { locale };
  },
});

export const getPreferencesForUser = internalQuery({
  args: { userId: v.string() },
  returns: preferencesValidator,
  handler: async (ctx, { userId }) => ({
    locale: await readAccountLocale(ctx, userId),
  }),
});
