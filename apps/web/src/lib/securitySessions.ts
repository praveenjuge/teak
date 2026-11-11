import type { api } from "@teak/convex";
import type { FunctionReturnType } from "convex/server";

/** `name` is the server's English name, shown when `agent` is missing. */
export type DeviceSession = FunctionReturnType<
  typeof api.securitySessions.listAuthkitSessions
>["page"][number];

export interface ConnectionTarget {
  consentId: string;
}
