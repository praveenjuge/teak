import * as Sentry from "@sentry/node";
import type { Context, Next } from "hono";
import type { MetricsRecorder } from "./shared/metrics.js";

const IGNORED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

export const sentryMetricsRecorder: MetricsRecorder = {
  count: (name, value, attributes) =>
    Sentry.metrics.count(name, value, { attributes }),
  gauge: (name, value, attributes, unit) =>
    Sentry.metrics.gauge(name, value, { attributes, unit }),
  distribution: (name, value, attributes, unit) =>
    Sentry.metrics.distribution(name, value, { attributes, unit }),
};

export const sentryRequestMiddleware = (
  c: Context,
  next: Next
): Promise<void> => {
  const requestId = crypto.randomUUID();
  const { method } = c.req;
  const path = new URL(c.req.url).pathname;

  return Sentry.withIsolationScope(async (scope) => {
    scope.setTag("surface", "api");
    scope.setTag("request_id", requestId);
    scope.setTag("http.method", method);
    scope.setTag("http.route", path);
    scope.setContext("request", {
      id: requestId,
      method,
      path,
      headers: Object.fromEntries(
        [...c.req.raw.headers.entries()].filter(
          ([name]) => !IGNORED_REQUEST_HEADERS.has(name.toLowerCase())
        )
      ),
    });

    try {
      await Sentry.startSpan(
        {
          name: `${method} ${path}`,
          op: "http.server",
          attributes: {
            "http.request.method": method,
            "url.path": path,
            "teak.request_id": requestId,
          },
        },
        next
      );
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    } finally {
      c.res.headers.set("X-Request-Id", requestId);
      scope.setTag("http.status_code", String(c.res.status));
    }
  });
};
