// Local copy of the dev-URL helper.
//
// Do NOT import this logic from `@teak/convex/dev-urls`. The Convex package
// exports raw `.ts` source files, which Node cannot resolve at runtime from
// the compiled `dist/` bundle in production. Keeping the helper local ensures
// `tsc` emits plain JS that Node can load directly. A regression test in
// `src/dependencies.test.ts` enforces this rule.

export const DEFAULT_TEAK_DEV_API_URL = "http://api.teak.localhost:1355";

export type DevUrlEnv = {
  [key: string]: unknown;
  TEAK_DEV_API_URL?: unknown;
};

const normalizeBaseUrl = (label: string, rawUrl: string): string => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${label}`);
  }

  parsedUrl.pathname = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/, "");
};

export const resolveTeakDevApiUrl = (env: DevUrlEnv = {}): string => {
  const raw =
    typeof env.TEAK_DEV_API_URL === "string" ? env.TEAK_DEV_API_URL.trim() : "";
  return normalizeBaseUrl("TEAK_DEV_API_URL", raw || DEFAULT_TEAK_DEV_API_URL);
};
