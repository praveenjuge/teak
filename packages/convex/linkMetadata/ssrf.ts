/**
 * Canonical server-side outbound URL policy (SSRF guard).
 *
 * Every server-side fetch or headless-browser navigation that targets a
 * user-controlled URL MUST be routed through this module. It enforces a single
 * policy so we don't have to re-derive the rules at each call site:
 *
 *   - only `http:` / `https:` schemes are allowed
 *   - embedded credentials (`user:pass@host`) are rejected
 *   - only the standard web ports are allowed (80, 443, or none)
 *   - the hostname is resolved via DNS and every resolved address must be a
 *     public, routable IP (loopback / private / link-local / metadata /
 *     reserved ranges are blocked for both IPv4 and IPv6)
 *   - automatic redirects are disabled; each redirect hop is re-validated
 *
 * NOTE: this module imports `node:dns`, so it can only be imported from Convex
 * actions that declare `"use node"`. Do NOT re-export it from the
 * `linkMetadata` barrel, which is also loaded by non-node functions.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "SsrfError";
    this.reason = reason;
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// Standard web ports only. An empty port means the protocol default (80/443).
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 5;

type Bytes = number[];
type Cidr = { base: Bytes; bits: number };

const parseIpv4ToBytes = (ip: string): Bytes | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes: Bytes = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    bytes.push(octet);
  }
  return bytes;
};

// Returns a 16-byte representation of an IPv6 address (with any IPv4 tail
// embedded in the final 4 bytes), or null when the literal is malformed.
const parseIpv6ToBytes = (ip: string): Bytes | null => {
  // Strip a zone id (e.g. fe80::1%eth0) before parsing.
  const withoutZone = ip.split("%")[0];

  // Handle IPv4-mapped / IPv4-embedded forms (e.g. ::ffff:192.168.0.1).
  const lastColon = withoutZone.lastIndexOf(":");
  let head = withoutZone;
  let embeddedIpv4: Bytes | null = null;
  const tail = withoutZone.slice(lastColon + 1);
  if (tail.includes(".")) {
    embeddedIpv4 = parseIpv4ToBytes(tail);
    if (embeddedIpv4 === null) {
      return null;
    }
    head = withoutZone.slice(0, lastColon + 1);
  }

  const doubleColonIndex = head.indexOf("::");
  let groups: string[];
  if (doubleColonIndex === -1) {
    groups = head.split(":").filter((g) => g.length > 0);
  } else {
    const left = head.slice(0, doubleColonIndex).split(":").filter(Boolean);
    const right = head
      .slice(doubleColonIndex + 2)
      .split(":")
      .filter(Boolean);
    const embeddedGroups = embeddedIpv4 === null ? 0 : 2;
    const missing = 8 - left.length - right.length - embeddedGroups;
    if (missing < 0) {
      return null;
    }
    groups = [...left, ...new Array(missing).fill("0"), ...right];
  }

  const expectedGroups = embeddedIpv4 === null ? 8 : 6;
  if (groups.length !== expectedGroups) {
    return null;
  }

  const bytes: Bytes = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  if (embeddedIpv4 !== null) {
    bytes.push(...embeddedIpv4);
  }
  return bytes;
};

const cidr = (base: string, bits: number, version: 4 | 6): Cidr => {
  const baseValue =
    version === 4 ? parseIpv4ToBytes(base) : parseIpv6ToBytes(base);
  if (baseValue === null) {
    throw new Error(`Invalid CIDR base: ${base}`);
  }
  return { base: baseValue, bits };
};

// Disallowed IPv4 ranges: loopback, private, link-local, CGN, metadata,
// documentation, benchmarking, multicast, reserved, broadcast, unspecified.
const BLOCKED_IPV4: Cidr[] = [
  cidr("0.0.0.0", 8, 4), // "this" network / unspecified
  cidr("10.0.0.0", 8, 4), // private
  cidr("100.64.0.0", 10, 4), // carrier-grade NAT
  cidr("127.0.0.0", 8, 4), // loopback
  cidr("169.254.0.0", 16, 4), // link-local (incl. 169.254.169.254 metadata)
  cidr("172.16.0.0", 12, 4), // private
  cidr("192.0.0.0", 24, 4), // IETF protocol assignments
  cidr("192.0.2.0", 24, 4), // TEST-NET-1
  cidr("192.88.99.0", 24, 4), // 6to4 relay anycast
  cidr("192.168.0.0", 16, 4), // private
  cidr("198.18.0.0", 15, 4), // benchmarking
  cidr("198.51.100.0", 24, 4), // TEST-NET-2
  cidr("203.0.113.0", 24, 4), // TEST-NET-3
  cidr("224.0.0.0", 4, 4), // multicast
  cidr("240.0.0.0", 4, 4), // reserved
];

// Disallowed IPv6 ranges. IPv4-mapped/translated addresses are decoded to their
// embedded IPv4 and checked against BLOCKED_IPV4 separately.
const BLOCKED_IPV6: Cidr[] = [
  cidr("::", 128, 6), // unspecified
  cidr("::1", 128, 6), // loopback
  cidr("100::", 64, 6), // discard-only
  cidr("2001:db8::", 32, 6), // documentation
  cidr("fc00::", 7, 6), // unique local
  cidr("fe80::", 10, 6), // link-local
  cidr("ff00::", 8, 6), // multicast
];

const IPV4_MAPPED_PREFIX = cidr("::ffff:0:0", 96, 6); // ::ffff:0:0/96
const IPV4_TRANSLATED_PREFIX = cidr("64:ff9b::", 96, 6); // 64:ff9b::/96

// Bitwise CIDR membership test over byte arrays. `value` and `range.base` must
// share the same byte length (4 for IPv4, 16 for IPv6).
const inRange = (value: Bytes, range: Cidr): boolean => {
  if (value.length !== range.base.length) {
    return false;
  }
  let bitsLeft = range.bits;
  for (let i = 0; i < value.length && bitsLeft > 0; i++) {
    if (bitsLeft >= 8) {
      if (value[i] !== range.base[i]) {
        return false;
      }
      bitsLeft -= 8;
    } else {
      const mask = (0xff << (8 - bitsLeft)) & 0xff;
      if ((value[i] & mask) !== (range.base[i] & mask)) {
        return false;
      }
      bitsLeft = 0;
    }
  }
  return true;
};

// The embedded IPv4 of a mapped/translated IPv6 is the final 4 bytes.
const ipv4FromMapped = (value: Bytes): Bytes => value.slice(12, 16);

/**
 * Returns true when the given IP literal points at a non-public destination
 * that server-side fetches must never reach.
 */
export const isBlockedIp = (ip: string): boolean => {
  const version = isIP(ip);
  if (version === 4) {
    const value = parseIpv4ToBytes(ip);
    if (value === null) {
      return true; // unparseable -> treat as unsafe
    }
    return BLOCKED_IPV4.some((range) => inRange(value, range));
  }
  if (version === 6) {
    const value = parseIpv6ToBytes(ip);
    if (value === null) {
      return true;
    }
    // Decode IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) forms
    // and validate the embedded IPv4 against the IPv4 policy.
    if (
      inRange(value, IPV4_MAPPED_PREFIX) ||
      inRange(value, IPV4_TRANSLATED_PREFIX)
    ) {
      const embedded = ipv4FromMapped(value);
      if (BLOCKED_IPV4.some((range) => inRange(embedded, range))) {
        return true;
      }
    }
    return BLOCKED_IPV6.some((range) => inRange(value, range));
  }
  // Not a valid IP literal.
  return true;
};

/**
 * Validates the structural properties of a URL (scheme, credentials, port).
 * Throws {@link SsrfError} when the URL violates the outbound policy. Returns
 * the parsed {@link URL} on success.
 */
export const assertUrlStructureSafe = (rawUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError("invalid_url", `Could not parse URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfError(
      "blocked_protocol",
      `Blocked protocol: ${parsed.protocol}`
    );
  }

  if (parsed.username || parsed.password) {
    throw new SsrfError(
      "credentials_in_url",
      "URLs with embedded credentials are not allowed"
    );
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new SsrfError("blocked_port", `Blocked port: ${parsed.port}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new SsrfError("empty_host", "URL is missing a hostname");
  }

  // If the host is already an IP literal, validate it immediately so we never
  // even issue a DNS lookup for an obviously private destination.
  if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
    throw new SsrfError(
      "blocked_address",
      `Blocked non-public address: ${hostname}`
    );
  }

  return parsed;
};

/**
 * Validates structure AND resolves DNS, ensuring every resolved address is a
 * public destination. Throws {@link SsrfError} otherwise.
 */
export const assertUrlIsSafe = async (rawUrl: string): Promise<URL> => {
  const parsed = assertUrlStructureSafe(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // Literal IPs were already validated in assertUrlStructureSafe.
  if (isIP(hostname) !== 0) {
    return parsed;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(
      "dns_resolution_failed",
      `Could not resolve hostname: ${hostname}`
    );
  }

  if (addresses.length === 0) {
    throw new SsrfError(
      "dns_resolution_failed",
      `Hostname did not resolve: ${hostname}`
    );
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(
        "blocked_address",
        `Hostname ${hostname} resolves to a non-public address (${address})`
      );
    }
  }

  return parsed;
};

/**
 * SSRF-hardened replacement for `fetch`. Validates the target URL (and every
 * redirect hop) against the outbound policy before issuing each request.
 * Redirects are followed manually so that intermediate hops cannot bounce the
 * request to an internal address.
 */
export const safeFetch = async (
  rawUrl: string,
  init: RequestInit = {}
): Promise<Response> => {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlIsSafe(currentUrl);

    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
    });

    const isRedirect =
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location");

    if (!isRedirect) {
      return response;
    }

    if (hop === MAX_REDIRECTS) {
      throw new SsrfError(
        "too_many_redirects",
        `Exceeded ${MAX_REDIRECTS} redirects starting from ${rawUrl}`
      );
    }

    const location = response.headers.get("location") as string;
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new SsrfError(
        "invalid_redirect",
        `Invalid redirect target: ${location}`
      );
    }
    // Drain the redirect body so the connection can be reused/closed cleanly.
    await response.body?.cancel().catch(() => {
      // ignore
    });
    currentUrl = nextUrl.toString();
  }

  // Unreachable, but keeps the type checker satisfied.
  throw new SsrfError("too_many_redirects", "Exceeded redirect limit");
};
