/**
 * WAF custom rules for the teakvault.com zone, applied by
 * `scripts/cloudflare-waf.ts`. They run before the Files Worker, so a
 * request they block never invokes it.
 *
 * Every rule here has a `ref` starting with WAF_RULE_REF_PREFIX; the script
 * creates, updates and deletes only rules with that prefix, so custom rules
 * made in the dashboard are never touched.
 */

import { API_PROXY_MAX_BODY_BYTES } from "../src/apiProxy";

export const WAF_ZONE_NAME = "teakvault.com";
export const WAF_RULE_REF_PREFIX = "teak-api-";

export interface WafBlockResponse {
  content: string;
  content_type: string;
  status_code: number;
}

export interface WafRule {
  action: "block";
  /** The answer a blocked request gets instead of Cloudflare's 403 page. */
  action_parameters?: { response: WafBlockResponse };
  description: string;
  enabled: boolean;
  expression: string;
  ref: string;
}

/**
 * The public API and MCP paths the Files Worker proxies, matching
 * `upstreamPathFor`: `/apis` or `/mcpfoo` belong to the site, not the API.
 */
export const API_PATHS =
  '(http.request.uri.path in {"/api" "/mcp"} or starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/mcp/"))';

/**
 * True when the declared Content-Length exceeds `maxBytes`. The exact body
 * size field (`http.request.body.size`) needs an Enterprise plan, so this
 * compares the header's digits: longer means larger, and equal-length
 * decimal strings compare like their numbers. A zero-padded length is
 * valid HTTP but breaks that comparison, so it is left to the Worker's own
 * numeric check.
 */
export const declaredLengthOver = (maxBytes: number): string => {
  const max = String(maxBytes);
  const length = 'http.request.headers["content-length"][0]';
  return `(not starts_with(${length}, "0") and (len(${length}) gt ${max.length} or (len(${length}) eq ${max.length} and ${length} gt "${max}")))`;
};

/** The Worker's own 413 for an oversized body, so API clients see one answer. */
export const CONTENT_TOO_LARGE_RESPONSE: WafBlockResponse = {
  status_code: 413,
  content_type: "application/json",
  content: JSON.stringify({
    code: "CONTENT_TOO_LARGE",
    error: "Request body is too large",
  }),
};

export const WAF_RULES: readonly WafRule[] = [
  {
    ref: `${WAF_RULE_REF_PREFIX}oversized-body`,
    description:
      "Teak API: refuse request bodies declared larger than Convex accepts (managed by scripts/cloudflare-waf.ts)",
    expression: `${API_PATHS} and ${declaredLengthOver(API_PROXY_MAX_BODY_BYTES)}`,
    action: "block",
    action_parameters: { response: CONTENT_TOO_LARGE_RESPONSE },
    enabled: true,
  },
];
