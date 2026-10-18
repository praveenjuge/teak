import { createRemoteJWKSet, customFetch, errors, jwtVerify } from "jose";
import { validateOAuthUrl } from "./shared/oauthUrl";
import {
  CONNECT_CONSENT_ID,
  WORKOS_CLIENT_ID,
  WORKOS_USER_ID,
} from "./shared/workosIds";

export type WorkosResource = "api" | "mcp";

interface WorkosPrincipal {
  externalId?: string | null;
  workosUserId: string;
}

export interface WorkosConnectPrincipal extends WorkosPrincipal {
  clientId: string;
  consentId: string;
}

export interface WorkosRevocationPrincipal extends WorkosConnectPrincipal {
  tokenExpiresAt: number;
}

interface ConnectTokenConfig {
  audience: string;
  issuer: string;
  onExpired?: () => void;
  onUnavailable?: () => void;
}

class WorkosJwksUnavailableError extends Error {}

const REQUIRED_SCOPES = ["openid", "profile", "email"];
let cachedJwks:
  | { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> }
  | undefined;

export function validWorkosExternalId(
  value: unknown
): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= 256)
  );
}

function validClientId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) {
    return false;
  }
  if (WORKOS_CLIENT_ID.test(value)) {
    return true;
  }
  // CIMD identifies the client by its metadata document URL. This URL is never fetched.
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      value.startsWith("https://") &&
      !/\s/.test(value)
    );
  } catch {
    return false;
  }
}

const CLOCK_TOLERANCE_SECONDS = 60;

// Configuration must come from the server, never from request/token claims.
// This verifies credentials only: callers must also check consent revocation,
// canonical owner mapping, verified email, deletion state and authorization.
export const verifyWorkosConnectToken = (
  token: string,
  config: ConnectTokenConfig
): Promise<WorkosConnectPrincipal | null> =>
  verifyConnectToken(token, config, false);

export const verifyWorkosConnectTokenForRevocation = (
  token: string,
  config: ConnectTokenConfig
): Promise<WorkosRevocationPrincipal | null> =>
  verifyConnectToken(token, config, true);

async function verifyConnectToken(
  token: string,
  config: ConnectTokenConfig,
  allowExpired: false
): Promise<WorkosConnectPrincipal | null>;
async function verifyConnectToken(
  token: string,
  config: ConnectTokenConfig,
  allowExpired: true
): Promise<WorkosRevocationPrincipal | null>;
async function verifyConnectToken(
  token: string,
  config: ConnectTokenConfig,
  allowExpired: boolean
): Promise<WorkosConnectPrincipal | WorkosRevocationPrincipal | null> {
  try {
    const issuer = validateOAuthUrl(config.issuer);
    if (
      issuer.protocol !== "https:" ||
      issuer.origin !== config.issuer ||
      issuer.username ||
      issuer.password ||
      issuer.port ||
      !config.audience ||
      token.length > 16_384
    ) {
      return null;
    }
    if (cachedJwks?.issuer !== config.issuer) {
      cachedJwks = {
        issuer: config.issuer,
        keys: createRemoteJWKSet(new URL("/oauth2/jwks", issuer), {
          [customFetch]: async (url, options) => {
            let response: Response;
            try {
              response = await fetch(url, options);
            } catch {
              throw new WorkosJwksUnavailableError();
            }
            if (!response.ok) {
              throw new WorkosJwksUnavailableError();
            }
            return response;
          },
        }),
      };
    }
    const options = {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: [
        "sub",
        "aud",
        "iss",
        "exp",
        "iat",
        "sid",
        "client_id",
        "scope",
      ],
    };
    let verified: Awaited<ReturnType<typeof jwtVerify>>;
    try {
      verified = await jwtVerify(token, cachedJwks.keys, options);
    } catch (error) {
      if (!(allowExpired && error instanceof errors.JWTExpired)) {
        throw error;
      }
      const expiry = error.payload.exp;
      if (typeof expiry !== "number" || !Number.isFinite(expiry)) {
        return null;
      }
      verified = await jwtVerify(token, cachedJwks.keys, {
        ...options,
        currentDate: new Date((expiry - 1) * 1000),
      });
    }
    const { payload } = verified;
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (
      payload.aud !== config.audience ||
      typeof payload.sub !== "string" ||
      !WORKOS_USER_ID.test(payload.sub) ||
      typeof payload.sid !== "string" ||
      !CONNECT_CONSENT_ID.test(payload.sid) ||
      !validClientId(payload.client_id) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 300 ||
      payload.iat > Math.floor(Date.now() / 1000) + CLOCK_TOLERANCE_SECONDS ||
      typeof payload.scope !== "string" ||
      !REQUIRED_SCOPES.every((scope) => scopes.includes(scope)) ||
      !validWorkosExternalId(payload.external_id)
    ) {
      return null;
    }
    return {
      ...(allowExpired ? { tokenExpiresAt: payload.exp } : {}),
      workosUserId: payload.sub,
      consentId: payload.sid,
      clientId: payload.client_id,
      ...(payload.external_id === undefined
        ? {}
        : { externalId: payload.external_id }),
    };
  } catch (error) {
    if (
      error instanceof errors.JWKSTimeout ||
      error instanceof WorkosJwksUnavailableError
    ) {
      config.onUnavailable?.();
    } else if (error instanceof errors.JWTExpired) {
      config.onExpired?.();
    }
    return null;
  }
}
