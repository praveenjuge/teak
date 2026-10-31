import { workosApiUrl } from "./workosApi";

// Teak calls a handful of WorkOS Management API endpoints, so it calls them
// directly instead of loading the Node SDK. The origin is fixed, path IDs are
// encoded by the callers and redirects are refused, so neither an ID nor a
// cursor can send the API key anywhere else.

const DEFAULT_TIMEOUT_MS = 10_000;

export const workosUserPath = (workosUserId: string, suffix = "") =>
  `/user_management/users/${encodeURIComponent(workosUserId)}${suffix}`;

export const workosRequest = (
  path: string,
  apiKey: string,
  options: {
    body?: Record<string, string>;
    method?: "DELETE" | "POST";
    query?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {}
) => {
  const url = workosApiUrl(path);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  return fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
};
