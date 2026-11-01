import { API_PROXY_MAX_BODY_BYTES } from "../src/edge/apiProxy";

export const WAF_ZONE_NAME = "teakvault.com";
export const WAF_RULE_REF_PREFIX = "teak-api-";

export interface WafRule {
  /**
   * A block answers with Cloudflare's 403 page. A custom 413 in the API's
   * shape needs a plan with custom responses, which this zone does not have.
   */
  action: "block";
  description: string;
  enabled: boolean;
  expression: string;
  ref: string;
}

export const API_REQUESTS = `http.host eq "${WAF_ZONE_NAME}" and (http.request.uri.path in {"/api" "/mcp"} or starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/mcp/"))`;

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

export const WAF_RULES: readonly WafRule[] = [
  {
    ref: `${WAF_RULE_REF_PREFIX}oversized-body`,
    description:
      "Teak API: refuse request bodies declared larger than Convex accepts (managed by scripts/cloudflare/cloudflare-waf.ts)",
    expression: `${API_REQUESTS} and ${declaredLengthOver(API_PROXY_MAX_BODY_BYTES)}`,
    action: "block",
    enabled: true,
  },
];
