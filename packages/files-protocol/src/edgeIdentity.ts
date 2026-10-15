/**
 * The edge identity lookup: the Files Worker asks Convex which Teak user a
 * credential belongs to, so edge rate limits follow the user rather than the
 * credential or the client's address. The Worker never sends the API key
 * itself, only its SHA-256 hex digest, and sends a WorkOS user ID only after
 * it has verified the access token that carries it.
 *
 * Requests are signed with the shared files signing secret over a payload
 * that starts with its own label, so a signed Files op can never be replayed
 * as a lookup or the other way round.
 */

export const EDGE_IDENTITY_PATH = "/edge/v1/identity" as const;

/** Longest a signed lookup stays valid, in seconds. */
export const EDGE_IDENTITY_MAX_TTL_SECONDS = 60;

export type EdgeIdentityLookup =
  | { tokenHash: string }
  | { workosUserId: string };

export interface EdgeIdentityResult {
  /** The credential owner's Teak user ID, or null when Convex does not know it. */
  userId: string | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const WORKOS_USER_ID = /^user_[0-9A-Za-z]{1,64}$/u;

/** The lookup in a request body, or null when the body is not exactly one valid lookup. */
export const parseEdgeIdentityLookup = (
  value: unknown
): EdgeIdentityLookup | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.tokenHash === "string" &&
    SHA256_HEX.test(record.tokenHash)
  ) {
    return { tokenHash: record.tokenHash };
  }
  if (
    typeof record.workosUserId === "string" &&
    WORKOS_USER_ID.test(record.workosUserId)
  ) {
    return { workosUserId: record.workosUserId };
  }
  return null;
};

export const buildEdgeIdentitySigningPayload = ({
  bodySha256,
  expiresAt,
  requestId,
}: {
  bodySha256: string;
  expiresAt: string;
  requestId: string;
}): string =>
  ["edge-identity", "1", requestId, expiresAt, bodySha256].join("\n");
