import { z } from "zod";

const text = z.string().min(1).max(4096);
const identifier = /^[A-Za-z0-9]{32}$/;
const oauthCode = z.strictObject({
  clientId: text,
  redirectURI: text,
  scope: z.array(z.string().min(1).max(128)).max(64),
  userId: text,
  authTime: z.number().finite().nonnegative(),
  requireConsent: z.boolean(),
  state: z.string().max(4096).nullable().optional(),
  codeChallenge: z.string().max(128).optional(),
  codeChallengeMethod: z.enum(["S256", "plain"]).optional(),
  nonce: z.string().max(4096).optional(),
});
const socialState = z.strictObject({
  callbackURL: text,
  codeVerifier: z.string().min(1).max(256),
  expiresAt: z.number().finite().nonnegative(),
  oauthState: z.string().regex(identifier).optional(),
  errorURL: text.optional(),
  newUserURL: text.optional(),
  link: z.strictObject({ email: text, userId: text }).optional(),
  requestSignUp: z.boolean().optional(),
});

// Pinned to the installed Better Auth OIDC authorize/state payloads. Uncertain
// rows stay untouched and block completion; values/tokens are never returned.
export function classifyLegacyGrant(row: {
  identifier: string;
  value: string;
}): "grant" | "other" | "ambiguous" {
  if (
    /^reset-password:[A-Za-z0-9]+$/.test(row.identifier) ||
    /^teak-oauth-used-refresh:[0-9a-f]{64}$/.test(row.identifier)
  ) {
    return "other";
  }
  const codeShaped = identifier.test(row.identifier);
  if (row.value.length > 32 * 1024) {
    return codeShaped ? "ambiguous" : "other";
  }
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    return codeShaped ? "ambiguous" : "other";
  }
  const potential =
    typeof value === "object" &&
    value !== null &&
    ("redirectURI" in value ||
      "requireConsent" in value ||
      "codeVerifier" in value ||
      "callbackURL" in value);
  if (!codeShaped) {
    return potential ? "ambiguous" : "other";
  }
  const code = oauthCode.safeParse(value);
  if (code.success) {
    return "grant";
  }
  const social = socialState.safeParse(value);
  if (
    social.success &&
    (social.data.oauthState === undefined ||
      social.data.oauthState === row.identifier)
  ) {
    return "grant";
  }
  return "ambiguous";
}
