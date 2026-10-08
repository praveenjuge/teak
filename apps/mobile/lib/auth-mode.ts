import type { PublicAuthMode } from "@teak/convex/auth";

export type { PublicAuthMode } from "@teak/convex/auth";
export function parseAuthMode(value: unknown): PublicAuthMode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unable to load sign-in configuration");
  }
  const mode = value as Record<string, unknown>;
  if (
    mode.primary !== "workos" ||
    typeof mode.signupsDisabled !== "boolean" ||
    typeof mode.accountChangesPaused !== "boolean" ||
    (mode.authKitClientId !== undefined &&
      (typeof mode.authKitClientId !== "string" ||
        !/^client_[A-Za-z0-9]{1,128}$/.test(mode.authKitClientId))) ||
    !mode.authKitClientId
  ) {
    throw new Error("Unable to load sign-in configuration");
  }
  return {
    primary: mode.primary,
    signupsDisabled: mode.signupsDisabled,
    accountChangesPaused: mode.accountChangesPaused,
    ...(typeof mode.authKitClientId === "string"
      ? { authKitClientId: mode.authKitClientId }
      : {}),
  };
}
