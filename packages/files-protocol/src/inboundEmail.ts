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

/**
 * Convex's routes for the Core Worker's email handler. Each POST is signed
 * over its path, a timestamp and the body's SHA-256
 * (`buildInboundEmailSigningPayload`).
 */
export const INBOUND_EMAIL_PATHS = {
  attachments: "/inbound/email/attachments",
  email: "/inbound/email",
} as const;

export const INBOUND_EMAIL_HEADERS = {
  signature: "x-teak-signature",
  timestamp: "x-teak-timestamp",
} as const;

/** Header fields (subject, date, Message-ID) are cut to RFC 5322's line limit. */
export const INBOUND_EMAIL_FIELD_MAX_CHARS = 998;

/** The most bytes Convex reads of one email request; it answers 413 above. */
export const INBOUND_EMAIL_MAX_REQUEST_BYTES = 3 * 1024 * 1024;

/**
 * Room in a request for everything besides the two bodies: the header fields
 * and up to 50 attachments' names, types and sizes.
 */
const INBOUND_EMAIL_ENVELOPE_BYTES = 256 * 1024;

/** The text and HTML bodies each stay under this, as encoded in the request. */
export const INBOUND_EMAIL_MAX_BODY_BYTES =
  (INBOUND_EMAIL_MAX_REQUEST_BYTES - INBOUND_EMAIL_ENVELOPE_BYTES) / 2;

/** The JSON body of a POST to `INBOUND_EMAIL_PATHS.email`. */
export interface InboundEmailPayload {
  attachments: Array<{
    fileName: string;
    index: number;
    mimeType: string;
    size: number;
  }>;
  date: string | null;
  from: string;
  html: string | null;
  messageId: string | null;
  subject: string;
  text: string | null;
  v: 1;
}

const HIGH_SURROGATE_END_REGEX = /[\uD800-\uDBFF]$/u;

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
export const cutUtf16 = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  const cut = value.slice(0, max);
  return HIGH_SURROGATE_END_REGEX.test(cut) ? cut.slice(0, -1) : cut;
};
