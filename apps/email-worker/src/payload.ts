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

const isContinuationByte = (byte: number): boolean =>
  byte >= 0x80 && byte < 0xc0;

/** At most `maxBytes` of UTF-8, never splitting a character. */
export const cutUtf8 = (value: string, maxBytes: number): string => {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  let end = Math.max(0, maxBytes);
  // Step back over continuation bytes (0x80–0xBF) to a character's start.
  while (end > 0 && isContinuationByte(bytes[end] ?? 0)) {
    end--;
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
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
    typeof email.html === "string" ? cutUtf8(email.html, maxBodyBytes) : null,
  messageId: email.messageId ?? null,
  subject: cutChars(email.subject ?? "", SUBJECT_MAX_CHARS),
  text:
    typeof email.text === "string" ? cutUtf8(email.text, maxBodyBytes) : null,
  v: 1,
});

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

export const sha256Hex = async (value: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export const hmacSha256Hex = async (
  secret: string,
  value: string
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  );
};

/** What the signature covers: route, time and the exact body. */
export const signingString = (
  path: string,
  timestamp: string,
  bodySha256: string
): string => `teak-inbound-email\nv1\n${path}\n${timestamp}\n${bodySha256}`;

export const signedHeaders = async (
  secret: string,
  path: string,
  body: string,
  nowMs: number
): Promise<Record<string, string>> => {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = await hmacSha256Hex(
    secret,
    signingString(path, timestamp, await sha256Hex(body))
  );
  return {
    "content-type": "application/json",
    "x-teak-signature": signature,
    "x-teak-timestamp": timestamp,
  };
};
