import { env } from "./_generated/server";
import { validateOAuthUrl } from "./client/authDiscovery";

/**
 * Typed backend environment resolvers. Variables are declared in
 * convex.config.ts (`defineApp({ env })`) and read here through the
 * generated typed `env` object.
 */

export const readSignupsDisabled = (): boolean => {
  const value = env.SIGNUPS_DISABLED;
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error("SIGNUPS_DISABLED must be true or false.");
};

export const readAccountChangesPaused = (): boolean => {
  const value = env.ACCOUNT_CHANGES_PAUSED;
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error("ACCOUNT_CHANGES_PAUSED must be true or false.");
};

export const readWorkosConnectIssuer = (): string => {
  const value = env.WORKOS_AUTHKIT_DOMAIN;
  if (!value) {
    throw new Error("WORKOS_AUTHKIT_DOMAIN is required.");
  }
  const url = validateOAuthUrl(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error(
      "WORKOS_AUTHKIT_DOMAIN must be an HTTPS origin without a port."
    );
  }
  return value;
};

// For callers that answer "unavailable" rather than throw: the validated
// Connect issuer, or undefined when it is missing or malformed.
export const findWorkosConnectIssuer = (): string | undefined => {
  try {
    return readWorkosConnectIssuer();
  } catch {
    return undefined;
  }
};
