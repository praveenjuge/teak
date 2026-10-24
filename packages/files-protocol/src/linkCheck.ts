/**
 * `check-link`: is a saved link's page still there? The dead-link fallback
 * asks when someone opens a link card that has an archived copy.
 */
export const FILES_LINK_CHECK_MAX_URL_LENGTH = 4096;

/** The Worker gives up after this long and answers `unsure`. */
export const FILES_LINK_CHECK_TIMEOUT_MS = 3500;

/** Redirects followed, each one checked like the first request. */
export const FILES_LINK_CHECK_MAX_REDIRECTS = 5;

export interface FilesLinkCheckParams {
  url: string;
}

/**
 * Only `dead` opens the archived copy: a 404 or 410 after redirects, or a
 * host whose A and AAAA lookups both answer NXDOMAIN. Everything else is
 * `alive` (a 2xx) or `unsure`, and both open the original.
 */
export type FilesLinkCheckOutcome = "alive" | "dead" | "unsure";

/**
 * Why, in a few words that are safe to send to analytics:
 * - `ok`: a 2xx;
 * - `http_404`, `http_410`: the page is gone;
 * - `dns`: the domain no longer exists;
 * - `http_status`: any other status (401, 403, 429, 5xx…);
 * - `dns_error`: the lookup failed, timed out or found no address;
 * - `blocked`: the outbound policy refused the address;
 * - `redirects`: too many redirects, or one that can't be followed;
 * - `fetch_failed`: the request failed (TLS, reset, refused);
 * - `fetcher_unavailable`: the link fetcher was missing or busy;
 * - `timeout`: no answer within the time limit.
 */
export type FilesLinkCheckReason =
  | "blocked"
  | "dns"
  | "dns_error"
  | "fetch_failed"
  | "fetcher_unavailable"
  | "http_404"
  | "http_410"
  | "http_status"
  | "ok"
  | "redirects"
  | "timeout";

export interface FilesLinkCheckResult {
  /** The final response's status, when one arrived. */
  httpStatus?: number;
  outcome: FilesLinkCheckOutcome;
  reason: FilesLinkCheckReason;
}
