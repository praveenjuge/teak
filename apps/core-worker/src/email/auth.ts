import { addressParser, type Email, type Header } from "postal-mime";

// Who sent a message, proven. The From address is only trusted when
// Cloudflare's own authentication verdict says the sender's domain passed
// DMARC for exactly that address's domain.
//
// Cloudflare adds its verdict as the topmost authentication header (an
// ARC-Authentication-Results with authserv-id mx.cloudflare.net) before the
// message reaches this Worker. Headers a sender wrote sit below it, so only
// the first authentication header is read; a forged "mx.cloudflare.net"
// header further down is never consulted. This relies on Cloudflare always
// adding its header: when the topmost one belongs to anyone else, or there is
// none, the message is refused. The first-deploy spike in README.md confirms
// the header on real mail.

export const CLOUDFLARE_AUTHSERV_ID = "mx.cloudflare.net";

const AUTH_HEADER_KEYS = new Set([
  "arc-authentication-results",
  "authentication-results",
]);

export type SenderRejection =
  | "dmarc_domain_mismatch"
  | "dmarc_fail"
  | "multiple_from"
  | "no_cloudflare_results"
  | "no_from";

export type SenderVerdict =
  | { from: string; ok: true }
  | { ok: false; reason: SenderRejection };

interface ResultInfo {
  method: string;
  properties: Map<string, string>;
  result: string;
}

/** Removes RFC 5322 comments, which may nest and hold any punctuation. */
export const stripComments = (value: string): string => {
  let out = "";
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      if (depth === 0) {
        out += char + value[i + 1];
      }
      i++;
      continue;
    }
    if (depth === 0 && char === '"') {
      quoted = !quoted;
      out += char;
      continue;
    }
    if (!quoted && char === "(") {
      depth++;
      continue;
    }
    if (!quoted && char === ")" && depth > 0) {
      depth--;
      continue;
    }
    if (depth === 0) {
      out += char;
    }
  }
  return out;
};

const unquote = (value: string): string =>
  value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;

export const parseAuthResults = (
  value: string,
  arc: boolean
): { authservId: string; results: ResultInfo[] } => {
  const parts = stripComments(value)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (arc && /^i\s*=\s*\d+$/i.test(parts[0] ?? "")) {
    parts.shift();
  }
  const authservId = (parts.shift() ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const results: ResultInfo[] = [];
  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const head = /^([a-z0-9_-]+)(?:\/\d+)?\s*=\s*([a-z0-9_-]+)$/i.exec(
      tokens.shift() ?? ""
    );
    if (!head) {
      continue;
    }
    const properties = new Map<string, string>();
    for (const token of tokens) {
      const property = /^([a-z0-9_.-]+)=(.+)$/i.exec(token);
      if (property?.[1] && property[2]) {
        properties.set(property[1].toLowerCase(), unquote(property[2]));
      }
    }
    results.push({
      method: (head[1] ?? "").toLowerCase(),
      properties,
      result: (head[2] ?? "").toLowerCase(),
    });
  }
  return { authservId, results };
};

const fromAddress = (
  headers: Header[]
): { address: string } | { reason: "multiple_from" | "no_from" } => {
  const fromHeaders = headers.filter((header) => header.key === "from");
  if (fromHeaders.length === 0) {
    return { reason: "no_from" };
  }
  if (fromHeaders.length > 1) {
    return { reason: "multiple_from" };
  }
  const mailboxes = addressParser(fromHeaders[0]?.value ?? "", {
    flatten: true,
  }).filter((mailbox) => mailbox.address);
  if (mailboxes.length === 0) {
    return { reason: "no_from" };
  }
  if (mailboxes.length > 1) {
    return { reason: "multiple_from" };
  }
  const address = (mailboxes[0]?.address ?? "").trim().toLowerCase();
  return address.includes("@") ? { address } : { reason: "no_from" };
};

export const verifySender = (email: Pick<Email, "headers">): SenderVerdict => {
  const from = fromAddress(email.headers);
  if ("reason" in from) {
    return { ok: false, reason: from.reason };
  }
  const topmost = email.headers.find((header) =>
    AUTH_HEADER_KEYS.has(header.key)
  );
  if (!topmost) {
    return { ok: false, reason: "no_cloudflare_results" };
  }
  const parsed = parseAuthResults(
    topmost.value,
    topmost.key === "arc-authentication-results"
  );
  if (parsed.authservId !== CLOUDFLARE_AUTHSERV_ID) {
    return { ok: false, reason: "no_cloudflare_results" };
  }
  const dmarc = parsed.results.filter((result) => result.method === "dmarc");
  if (dmarc.length === 0 || dmarc.some((result) => result.result !== "pass")) {
    return { ok: false, reason: "dmarc_fail" };
  }
  const domain = from.address.slice(from.address.lastIndexOf("@") + 1);
  if (
    dmarc.some(
      (result) => result.properties.get("header.from")?.toLowerCase() !== domain
    )
  ) {
    return { ok: false, reason: "dmarc_domain_mismatch" };
  }
  return { from: from.address, ok: true };
};
