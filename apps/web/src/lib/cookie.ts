export interface CookieInit {
  domain?: string;
  httpOnly?: boolean;
  maxAge: number;
  name: string;
  path: string;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  value: string;
}

const SAME_SITE = { lax: "Lax", strict: "Strict", none: "None" } as const;

export function serializeCookie(cookie: CookieInit): string {
  return [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAge}`,
    ...(cookie.domain ? [`Domain=${cookie.domain}`] : []),
    `SameSite=${SAME_SITE[cookie.sameSite]}`,
    ...(cookie.secure ? ["Secure"] : []),
    ...(cookie.httpOnly ? ["HttpOnly"] : []),
  ].join("; ");
}

/**
 * A copy of `response` with extra `Set-Cookie` headers. Responses such as
 * `Response.redirect()` have immutable headers, so this never edits in place.
 */
export function withCookies(
  response: Response,
  cookies: readonly CookieInit[]
): Response {
  if (cookies.length === 0) {
    return response;
  }
  const copy = new Response(response.body, response);
  for (const cookie of cookies) {
    copy.headers.append("Set-Cookie", serializeCookie(cookie));
  }
  return copy;
}
