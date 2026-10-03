import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { env } from "../_generated/server";
import { readSignupsDisabled } from "../env";
import { SIGNUPS_PAUSED_MESSAGE } from "../shared/constants";
import { guardUserCreation } from "../signupFreeze";

const authFunctions: AuthFunctions = internal.migration.workosReadiness;
export const readinessAuthKit =
  process.env.WORKOS_ENVIRONMENT_ID === "environment_01KBYSVN9RVQ1JXACG3MDMQZGA"
    ? new AuthKit<DataModel>(components.workOSAuthKit, {
        authFunctions,
        webhookSecret: process.env.WORKOS_WEBHOOK_SECRET,
        actionSecret: process.env.WORKOS_ACTION_SECRET,
      })
    : undefined;

// Phase R callbacks only sync the isolated AuthKit component and log receipts.
// A WorkOS deletion cannot reach any Teak data-deletion path.
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
    return action.userData.email.startsWith("phase-r-deny-")
      ? response.deny("Readiness registration denied")
      : response.allow();
  },
}).authKitAction;
