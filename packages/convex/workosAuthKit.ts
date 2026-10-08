import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { readSignupsDisabled } from "./env";
import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

// User lifecycle events go through Teak's own signed webhook (workosWebhook.ts),
// so the component only needs the registration Action.
const authFunctions: AuthFunctions = internal.workosAuthKit;

// A deployment with a WorkOS environment gets the AuthKit routes.
export const authKit = process.env.WORKOS_ENVIRONMENT_ID
  ? new AuthKit<DataModel>(components.workOSAuthKit, {
      authFunctions,
      webhookSecret: process.env.WORKOS_WEBHOOK_SECRET,
      actionSecret: process.env.WORKOS_ACTION_SECRET,
    })
  : undefined;

export const authKitAction = authKit?.actions({
  // This guard also covers native provider flows that bypass sign-up options.
  userRegistration: async (_ctx, _action, response) =>
    readSignupsDisabled()
      ? response.deny(SIGNUPS_PAUSED_MESSAGE)
      : response.allow(),
}).authKitAction;
