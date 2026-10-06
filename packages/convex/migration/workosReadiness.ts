import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { readSignupsDisabled } from "../env";
import { SIGNUPS_PAUSED_MESSAGE } from "../shared/constants";
import { guardUserCreation } from "../signupFreeze";

const authFunctions: AuthFunctions = internal.migration.workosReadiness;
export const readinessAuthKit =
  process.env.WORKOS_ENVIRONMENT_ID ===
    "environment_01KBYSVN9RVQ1JXACG3MDMQZGA" ||
  process.env.WORKOS_ENVIRONMENT_ID === "environment_01M46HC8CJ5D0THX3EP6WVDKMM"
    ? new AuthKit<DataModel>(components.workOSAuthKit, {
        authFunctions,
        webhookSecret: process.env.WORKOS_WEBHOOK_SECRET,
        actionSecret: process.env.WORKOS_ACTION_SECRET,
      })
    : undefined;

// Canonical lifecycle processing runs in the signed webhook transaction.
// Component callbacks log receipts without granting deletion authority.
export const authKitEvent = readinessAuthKit?.events({
  "user.created": (_ctx, event) => {
    console.info("workos-readiness-receipt", event.event, event.data.id);
    return Promise.resolve();
  },
  "user.updated": (_ctx, event) => {
    console.info("workos-readiness-receipt", event.event, event.data.id);
    return Promise.resolve();
  },
  "user.deleted": (_ctx, event) => {
    console.info("workos-readiness-receipt", event.event, event.data.id);
    return Promise.resolve();
  },
}).authKitEvent;

export const authKitAction = readinessAuthKit?.actions({
  userRegistration: async (_ctx, action, response) => {
    console.info("workos-readiness-registration", action.object);
    try {
      await guardUserCreation({
        email: action.userData.email,
        disabled: readSignupsDisabled(),
        e2eEmailDomain: env.E2E_EMAIL_DOMAIN,
      });
    } catch {
      return response.deny(SIGNUPS_PAUSED_MESSAGE);
    }
    return process.env.WORKOS_ENVIRONMENT_ID ===
      "environment_01KBYSVN9RVQ1JXACG3MDMQZGA" &&
      action.userData.email.startsWith("phase-r-deny-")
      ? response.deny("Readiness registration denied")
      : response.allow();
  },
}).authKitAction;
