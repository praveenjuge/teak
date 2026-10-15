import { env } from "./_generated/server";
import { validateOAuthUrl } from "./shared/oauthUrl";
import {
  PRODUCTION_WORKOS_RESOURCES,
  type WorkosResources,
  workosResourcesFor,
} from "./shared/workosResources";

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

/** True only on the shared cloud dev deployment (TEAK_DEV_DEPLOYMENT=true). */
export const readIsDevDeployment = (): boolean =>
  env.TEAK_DEV_DEPLOYMENT === "true";

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

// This deployment's WorkOS token audiences. Unset keeps the production
// resources; the dev deployment sets its own convex.site origin so the MCP
// resource matches the URL clients connect to (RFC 9728).
export const readWorkosResources = (): WorkosResources => {
  const value = env.WORKOS_RESOURCE_ORIGIN;
  if (value === undefined) {
    return PRODUCTION_WORKOS_RESOURCES;
  }
  let origin: string | undefined;
  try {
    origin = validateOAuthUrl(value, true).origin;
  } catch {
    // Reported below with the variable's name.
  }
  if (origin !== value) {
    throw new Error(
      "WORKOS_RESOURCE_ORIGIN must be an HTTPS (or loopback) origin without a path or trailing slash."
    );
  }
  return workosResourcesFor(value);
};

// For callers that answer "unavailable" rather than throw.
export const findWorkosResources = (): WorkosResources | undefined => {
  try {
    return readWorkosResources();
  } catch {
    return undefined;
  }
};
