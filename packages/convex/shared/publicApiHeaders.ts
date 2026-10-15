export const PUBLIC_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Idempotency-Key, X-Request-Id",
  "Access-Control-Expose-Headers":
    "X-Request-Id, Idempotency-Key, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  "Access-Control-Max-Age": "86400",
};
