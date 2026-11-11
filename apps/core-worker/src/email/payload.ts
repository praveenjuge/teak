import {
  buildInboundEmailSigningPayload,
  cutUtf16,
  hmacSha256Hex,
  INBOUND_EMAIL_FIELD_MAX_CHARS,
  INBOUND_EMAIL_HEADERS,
  INBOUND_EMAIL_MAX_BODY_BYTES,
  type InboundEmailPayload,
  sha256Hex,
} from "@teak/files-protocol";
import type { Email } from "postal-mime";
import type { SelectedAttachment } from "./attachments";

// The request Convex receives for a message, and its signature. Convex checks
// the signature over the exact body and a timestamp within five minutes, so a
// captured request can't be replayed later or sent to another route.

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * MAX_BODY_BYTES, or the default when unset or not a positive integer, and
 * never more than both bodies can carry within Convex's request limit.
 */
export const maxBodyBytes = (configured: string | undefined): number => {
  const value = Number(configured);
  return Math.min(
    Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_BODY_BYTES,
    INBOUND_EMAIL_MAX_BODY_BYTES
  );
};

const jsonBytes = (value: string): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength - 2;

/**
 * At most `maxBytes` once encoded as a JSON string, never splitting a
 * character. Escaping can more than double a body (quotes, backslashes,
 * control characters), so the request is sized by what is sent.
 */
export const cutJsonUtf8 = (value: string, maxBytes: number): string => {
  if (jsonBytes(value) <= maxBytes) {
    return value;
  }
  let low = 0;
  let high = Math.min(value.length, maxBytes);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (jsonBytes(cutUtf16(value, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return cutUtf16(value, low);
};

export const buildPayload = (
  email: Pick<Email, "date" | "html" | "messageId" | "subject" | "text">,
  from: string,
  attachments: SelectedAttachment[],
  maxBodyBytes: number
): InboundEmailPayload => ({
  attachments: attachments.map(({ fileName, index, mimeType, size }) => ({
    fileName,
    index,
    mimeType,
    size,
  })),
  date: email.date ?? null,
  from,
  html:
    typeof email.html === "string"
      ? cutJsonUtf8(email.html, maxBodyBytes)
      : null,
  messageId: email.messageId ?? null,
  subject: cutUtf16(email.subject ?? "", INBOUND_EMAIL_FIELD_MAX_CHARS),
  text:
    typeof email.text === "string"
      ? cutJsonUtf8(email.text, maxBodyBytes)
      : null,
  v: 1,
});

export const signedHeaders = async (
  secret: string,
  path: string,
  body: string,
  nowMs: number
): Promise<Record<string, string>> => {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = await hmacSha256Hex(
    secret,
    buildInboundEmailSigningPayload(path, timestamp, await sha256Hex(body))
  );
  return {
    "content-type": "application/json",
    [INBOUND_EMAIL_HEADERS.signature]: signature,
    [INBOUND_EMAIL_HEADERS.timestamp]: timestamp,
  };
};
