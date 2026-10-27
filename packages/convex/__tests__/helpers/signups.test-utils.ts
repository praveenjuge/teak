import type { MutationCtx } from "../../_generated/server";
import { DEFAULT_ADMIN_SETTINGS, readSettingsRow } from "../../adminAccess";

interface Backend {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
}

/** Flips the admin console's sign-up pause, the only sign-up switch. */
export const setSignupsPaused = (t: Backend, signupsPaused: boolean) =>
  t.run(async (ctx) => {
    const row = await readSettingsRow(ctx);
    if (row) {
      await ctx.db.patch("adminSettings", row._id, { signupsPaused });
      return;
    }
    const { updatedAt: _ignored, ...defaults } = DEFAULT_ADMIN_SETTINGS;
    await ctx.db.insert("adminSettings", {
      key: "global",
      ...defaults,
      signupsPaused,
      updatedAt: Date.now(),
    });
  });
