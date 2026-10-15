import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { readSignupsPaused } from "./adminAccess";
import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

const authFunctions: AuthFunctions = internal.workosAuthKit;

export const authKit = process.env.WORKOS_ENVIRONMENT_ID
  ? new AuthKit<DataModel>(components.workOSAuthKit, {
      authFunctions,
      webhookSecret: process.env.WORKOS_WEBHOOK_SECRET,
      actionSecret: process.env.WORKOS_ACTION_SECRET,
    })
  : undefined;

export const authKitAction = authKit?.actions({
  userRegistration: async (ctx, _action, response) =>
    (await readSignupsPaused(ctx))
      ? response.deny(SIGNUPS_PAUSED_MESSAGE)
      : response.allow(),
}).authKitAction;
