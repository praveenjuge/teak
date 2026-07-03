import { getSafeNextPath } from "./safe-next-path";

// The better-auth `mcp` plugin redirects an unauthenticated user who hits
// `/api/auth/mcp/authorize` to `${loginPage}?<raw authorize query>` — i.e.
// `/login?client_id=...&redirect_uri=...&response_type=code&code_challenge=...`.
// It does NOT wrap the target in a `next=` param. To resume the OAuth flow
// after authentication we send the user back through the authorize endpoint so
// the code is minted against their freshly established session.
const MCP_AUTHORIZE_PATH = "/api/auth/mcp/authorize";

export interface AuthRedirectTarget {
  /** True when the current page load originated from an OAuth authorize redirect. */
  isOAuthAuthorize: boolean;
  /** Safe, same-origin relative path to navigate to after authentication. */
  nextPath: string;
}

/**
 * Resolve where to send the user after a successful sign-in / sign-up.
 *
 * Precedence:
 * 1. An explicit, same-origin `next=` value (validated by `getSafeNextPath`).
 * 2. A raw OAuth authorize query (`client_id` + `response_type=code`) → route
 *    back through `/api/auth/mcp/authorize` preserving the original query.
 * 3. Fallback to the app root.
 */
export function resolveAuthRedirect(
  searchParams: URLSearchParams
): AuthRedirectTarget {
  // An explicit `next=` always wins and is validated for same-origin safety.
  const explicitNext = getSafeNextPath(searchParams.get("next"));
  if (explicitNext) {
    return { isOAuthAuthorize: false, nextPath: explicitNext };
  }

  // OAuth authorize redirects carry the raw authorize query. The minimum
  // viable shape is a client id plus the authorization-code response type.
  const hasOAuthShape =
    Boolean(searchParams.get("client_id")) &&
    searchParams.get("response_type") === "code";

  if (hasOAuthShape) {
    const authorizeTarget = `${MCP_AUTHORIZE_PATH}?${searchParams.toString()}`;
    const safeTarget = getSafeNextPath(authorizeTarget);
    if (safeTarget) {
      return { isOAuthAuthorize: true, nextPath: safeTarget };
    }
  }

  return { isOAuthAuthorize: false, nextPath: "/" };
}
