/// <reference types="vite/client" />
import { SUPPORTED_LOCALES } from "@teak/i18n/locales";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, internal } from "../_generated/api";
import { accountDeletionStage } from "../accountDeletion/stages";
import schema from "../schema";

// The account's UI language (settings/preferences.ts): English until the
// account picks one of @teak/i18n's languages in Settings.

const modules = import.meta.glob("../**/*.ts");

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConvexError
      ? (error.data as { code: string }).code
      : String(error);
  }
  throw new Error("expected the call to fail");
};

const setup = () => {
  const t = convexTest(schema, modules);
  const signIn = async (teakUserId: string) => {
    const workosUserId = await seedWorkosOwner(t, teakUserId);
    return t.withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: workosUserId,
      sid: `session_${teakUserId}`,
      email_verified: true,
      external_id: teakUserId,
    });
  };
  const rows = (userId: string) =>
    t.run((ctx) =>
      ctx.db
        .query("userPreferences")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect()
    );
  return { t, signIn, rows };
};

describe("account language", () => {
  test("is English before the account picks one, with nothing stored", async () => {
    const { signIn, rows } = setup();
    const owner = await signIn("owner");
    expect(
      await owner.query(api.settings.preferences.getPreferences, {})
    ).toEqual({ locale: "en" });
    expect(await rows("owner")).toEqual([]);
  });

  test("reads as null signed out, and can't be set signed out", async () => {
    const { t } = setup();
    expect(await t.query(api.settings.preferences.getPreferences, {})).toBe(
      null
    );
    expect(
      await codeOf(
        t.mutation(api.settings.preferences.setLocale, { locale: "de" })
      )
    ).toBe("UNAUTHENTICATED");
  });

  test.each(SUPPORTED_LOCALES.map((locale) => [locale]))(
    "keeps %s once chosen",
    async (locale) => {
      const { signIn } = setup();
      const owner = await signIn("owner");
      expect(
        await owner.mutation(api.settings.preferences.setLocale, { locale })
      ).toEqual({ locale });
      expect(
        await owner.query(api.settings.preferences.getPreferences, {})
      ).toEqual({ locale });
    }
  );

  test.each(["xx", "", "DE", "de-DE", "zh-Hant", "en-XA"])(
    "refuses %j with UNSUPPORTED_LOCALE and keeps the current one",
    async (locale) => {
      const { signIn, rows } = setup();
      const owner = await signIn("owner");
      await owner.mutation(api.settings.preferences.setLocale, {
        locale: "fr",
      });
      expect(
        await codeOf(
          owner.mutation(api.settings.preferences.setLocale, { locale })
        )
      ).toBe("UNSUPPORTED_LOCALE");
      expect(await rows("owner")).toMatchObject([{ locale: "fr" }]);
    }
  );

  test("changing it updates the one row and its time", async () => {
    const { signIn, rows } = setup();
    const owner = await signIn("owner");
    await owner.mutation(api.settings.preferences.setLocale, { locale: "de" });
    const [first] = await rows("owner");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await owner.mutation(api.settings.preferences.setLocale, { locale: "ja" });
    const after = await rows("owner");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      _id: first?._id,
      userId: "owner",
      locale: "ja",
    });
    expect(after[0]?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0);
  });

  test("a stored code this release doesn't support reads as English", async () => {
    const { t, signIn } = setup();
    const owner = await signIn("owner");
    await t.run((ctx) =>
      ctx.db.insert("userPreferences", {
        userId: "owner",
        locale: "tlh",
        updatedAt: 1,
      })
    );
    expect(
      await owner.query(api.settings.preferences.getPreferences, {})
    ).toEqual({ locale: "en" });
    expect(
      await t.query(internal.settings.preferences.getPreferencesForUser, {
        userId: "owner",
      })
    ).toEqual({ locale: "en" });
  });

  test("each account reads and writes only its own", async () => {
    const { t, signIn, rows } = setup();
    const owner = await signIn("owner");
    const other = await signIn("other");
    await owner.mutation(api.settings.preferences.setLocale, { locale: "de" });
    expect(
      await other.query(api.settings.preferences.getPreferences, {})
    ).toEqual({ locale: "en" });
    await other.mutation(api.settings.preferences.setLocale, { locale: "ko" });
    expect(
      await owner.query(api.settings.preferences.getPreferences, {})
    ).toEqual({ locale: "de" });
    expect(await rows("owner")).toMatchObject([{ locale: "de" }]);
    expect(await rows("other")).toMatchObject([{ locale: "ko" }]);
    // The account comes from the session; a userId argument is refused.
    await expect(
      other.mutation(api.settings.preferences.setLocale, {
        locale: "es",
        userId: "owner",
      } as never)
    ).rejects.toThrow(/userId/);
    expect(await rows("owner")).toMatchObject([{ locale: "de" }]);
    expect(
      await t.query(internal.settings.preferences.getPreferencesForUser, {
        userId: "owner",
      })
    ).toEqual({ locale: "de" });
  });

  test("account deletion removes it, page after page", async () => {
    const { t, rows } = setup();
    const workosUserId = await seedWorkosOwner(t, "owner");
    // More rows than one page takes, so the page has to say there is more.
    await t.run(async (ctx) => {
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("userPreferences", {
          userId: "owner",
          locale: "de",
          updatedAt: index,
        });
      }
      await ctx.db.insert("userPreferences", {
        userId: "kept",
        locale: "fr",
        updatedAt: 1,
      });
    });
    const stateId = await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        generation: 1,
        stage: accountDeletionStage("accountData"),
        startedAt: Date.now(),
        userId: "owner",
        workosUserId,
      })
    );
    const page = () =>
      t.mutation(internal.accountDeletionData.ancillaryPage, {
        generation: 1,
        stateId,
      });
    expect(await page()).toBe(true);
    expect((await rows("owner")).length).toBeGreaterThan(0);
    let pages = 1;
    while ((await page()) && pages < 10) {
      pages += 1;
    }
    expect(await rows("owner")).toEqual([]);
    expect(await rows("kept")).toMatchObject([{ locale: "fr" }]);
  });
});
