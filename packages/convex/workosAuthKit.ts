import { type AuthFunctions, AuthKit } from "@convex-dev/workos-authkit";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

const authFunctions: AuthFunctions = internal.workosAuthKit;

export const authKit = process.env.WORKOS_ENVIRONMENT_ID
  ? new AuthKit<DataModel>(components.workOSAuthKit, {
      authFunctions,
      webhookSecret: process.env.WORKOS_WEBHOOK_SECRET,
    })
  : undefined;
