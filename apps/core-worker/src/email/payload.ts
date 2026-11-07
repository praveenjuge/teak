import {
  buildInboundEmailSigningPayload,
  hmacSha256Hex,
  sha256Hex,
} from "@teak/files-protocol";
import type { Email } from "postal-mime";
import type { SelectedAttachment } from "./attachments";

// The request Convex receives for a message, and its signature. Convex checks
// the signature over the exact body and a timestamp within five minutes, so a
// captured request can't be replayed later or sent to another route.

export const INGEST_PATH = "/inbound/email";
export const FINALIZE_PATH = "/inbound/email/attachments";
export const SUBJECT_MAX_CHARS = 998;
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

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

const prefix = (value: string, length: number): string => {
  const cut = value.slice(0, length);
  return HIGH_SURROGATE_END_REGEX.test(cut) ? cut.slice(0, -1) : cut;
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
    if (jsonBytes(prefix(value, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return prefix(value, low);
};

const cutChars = (value: string, max: number): string => {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
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
  subject: cutChars(email.subject ?? "", SUBJECT_MAX_CHARS),
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
    "x-teak-signature": signature,
    "x-teak-timestamp": timestamp,
  };
};
