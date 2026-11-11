import { env } from "./_generated/server";
import { OAUTH_SURFACES } from "./shared/oauthSurfaces";
import { isWorkosIssuer, validateOAuthUrl } from "./shared/oauthUrl";
import { parseWorkosApiBase } from "./shared/workosApi";
import { WORKOS_CLIENT_ID } from "./shared/workosIds";
import {
  PRODUCTION_WORKOS_RESOURCES,
  type WorkosResources,
  workosResourcesFor,
} from "./shared/workosResources";

export const readIsDevDeployment = (): boolean =>
  env.TEAK_DEV_DEPLOYMENT === "true";

// A self-hosted deployment without Polar sets BILLING_DISABLED=true: every
// account gets Pro (no card limit), and checkout and the billing portal are
// refused. Subscriptions themselves stay as they are, so admin revenue and
// subscriber counts keep reading real ones.
export const readBillingDisabled = (): boolean =>
  env.BILLING_DISABLED?.trim().toLowerCase() === "true";

/** Polar's API access, or null on a deployment without a token. */
export const readPolarAccess = (): {
  accessToken: string;
  server: "production" | "sandbox";
} | null =>
  env.POLAR_ACCESS_TOKEN
    ? {
        accessToken: env.POLAR_ACCESS_TOKEN,
        server: env.POLAR_SERVER === "production" ? "production" : "sandbox",
      }
    : null;

// WORKOS_API_KEY and WORKOS_CLIENT_ID aren't declared in convex.config.ts
// (auth.config.ts reads the client ID before any function runs), so they
// are read untyped, here only.

/** The WorkOS Management API key, when this deployment has one. */
export const readWorkosApiKey = (): string | undefined =>
  process.env.WORKOS_API_KEY || undefined;

/**
 * This deployment's AuthKit client ID; "" when unset, which no WorkOS
 * token's audience matches.
 */
export const readWorkosClientId = (): string =>
  process.env.WORKOS_CLIENT_ID ?? "";

/** WorkOS's API origin: api.workos.com, or a loopback emulator. */
export const readWorkosApiBase = (): URL =>
  parseWorkosApiBase(env.WORKOS_API_BASE_URL);

/** The WorkOS Connect client of each OAuth surface (CLI, Raycast, browsers). */
export const readWorkosConnectClients = () => {
  const configured = {
    cli: env.WORKOS_CONNECT_CLI_CLIENT_ID,
    raycast: env.WORKOS_CONNECT_RAYCAST_CLIENT_ID,
    chrome: env.WORKOS_CONNECT_CHROME_CLIENT_ID,
    firefox: env.WORKOS_CONNECT_FIREFOX_CLIENT_ID,
  };
  return Object.fromEntries(
    OAUTH_SURFACES.map((surface) => {
      const clientId = configured[surface];
      if (!(clientId && WORKOS_CLIENT_ID.test(clientId))) {
        throw new Error(
          `Missing or invalid WorkOS Connect client for ${surface}.`
        );
      }
      return [surface, clientId];
    })
  );
};

export const readWorkosConnectIssuer = (): string => {
  const value = env.WORKOS_AUTHKIT_DOMAIN;
  if (!value) {
    throw new Error("WORKOS_AUTHKIT_DOMAIN is required.");
  }
  if (!isWorkosIssuer(value)) {
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
