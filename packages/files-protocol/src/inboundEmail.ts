/**
 * The Save by email address, which Convex shows and the Core Worker
 * accepts mail for: `save@<domain>`, and `save+anything@<domain>`. Both
 * sides read the domain from their own INBOUND_EMAIL_DOMAIN through
 * `inboundEmailDomain`, so they normalise it the same way.
 */

/**
 * The domain a deployment without INBOUND_EMAIL_DOMAIN uses: Teak's own,
 * which Teak's Convex deployments rely on. A self-hosted deployment that
 * turns Save by email on sets its own on both sides (self-hosting.mdx).
 */
export const DEFAULT_INBOUND_EMAIL_DOMAIN = "in.teakvault.com";

/** A deployment's Save by email domain, lowercase. */
export const inboundEmailDomain = (configured: string | undefined): string =>
  configured?.trim().toLowerCase() || DEFAULT_INBOUND_EMAIL_DOMAIN;

/** The address people send to. */
export const inboundSaveAddress = (domain: string): string => `save@${domain}`;

const SAVE_ADDRESS_REGEX = /^save(?:\+[^@]*)?@([^@]+)$/i;

/** Mail to this recipient is for Save by email on `domain`. */
export const isSaveAddress = (to: string, domain: string): boolean => {
  const address = to.trim().replace(/^<|>$/g, "");
  const match = SAVE_ADDRESS_REGEX.exec(address);
  return match?.[1]?.toLowerCase() === domain.trim().toLowerCase();
};
