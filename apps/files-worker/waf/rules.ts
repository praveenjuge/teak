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

export interface WafRule {
  action: "block";
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
 * decimal strings compare like their numbers.
 */
export const declaredLengthOver = (maxBytes: number): string => {
  const max = String(maxBytes);
  const length = 'http.request.headers["content-length"][0]';
  return `(len(${length}) gt ${max.length} or (len(${length}) eq ${max.length} and ${length} gt "${max}"))`;
};

export const WAF_RULES: readonly WafRule[] = [
  {
    ref: `${WAF_RULE_REF_PREFIX}oversized-body`,
    description:
      "Teak API: refuse request bodies declared larger than Convex accepts (managed by scripts/cloudflare-waf.ts)",
    expression: `${API_PATHS} and ${declaredLengthOver(API_PROXY_MAX_BODY_BYTES)}`,
    action: "block",
    enabled: true,
  },
];
