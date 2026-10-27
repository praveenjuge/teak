import { env } from "./_generated/server";
import { validateOAuthUrl } from "./shared/oauthUrl";
import {
  PRODUCTION_WORKOS_RESOURCES,
  type WorkosResources,
  workosResourcesFor,
} from "./shared/workosResources";

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
    origin = undefined;
  }
  if (origin !== value) {
    throw new Error(
      "WORKOS_RESOURCE_ORIGIN must be an HTTPS (or loopback) origin without a path or trailing slash."
    );
  }
  return workosResourcesFor(value);
};

export const findWorkosResources = (): WorkosResources | undefined => {
  try {
    return readWorkosResources();
  } catch {
    return undefined;
  }
};
