import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { readSignupsDisabled } from "./env";
import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";
import { userCreationAllowed } from "./signupFreeze";

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
  userRegistration: async (_ctx, action, response) =>
    userCreationAllowed({
      email: action.userData.email,
      disabled: readSignupsDisabled(),
      e2eEmailDomain: env.E2E_EMAIL_DOMAIN,
    })
      ? response.allow()
      : response.deny(SIGNUPS_PAUSED_MESSAGE),
}).authKitAction;

// Operator-run, once: copies WorkOS users the component has never seen (mostly
// accounts imported before its webhook was wired) into its own users table.
// It only inserts missing users and fires no Teak callbacks, so it can't
// create or change a Teak owner. Production runs need explicit approval.
export const backfillUsers = authKit?.utils().backfillUsers;
