export type ErrorResponseBody = {
  code: string;
  error: string;
};

export type HeaderMap = Record<string, string | string[] | undefined>;

export const json = (
  status: number,
  body: ErrorResponseBody | Record<string, unknown>
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const parseBearerToken = (
  authorization: string | null
): string | null => {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (!(scheme && token) || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  const normalized = token.trim();
  return normalized ? normalized : null;
};

export const getHeaderValue = (
  headers: HeaderMap | undefined,
  name: string
): string | null => {
  if (!headers) {
    return null;
  }

  const target = name.toLowerCase();
  for (const [key, rawValue] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }

    if (typeof rawValue === "string") {
      return rawValue;
    }

    if (Array.isArray(rawValue)) {
      return rawValue.join(", ");
    }
  }

  return null;
};
